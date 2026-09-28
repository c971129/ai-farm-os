from __future__ import annotations

"""Read-only Senoiot adapter. Credentials never leave this module's HTTP client.

Separate SQLite storage keeps vendor observations out of the simulation engine.
History uses bounded time windows rather than trusting broken vendor page counts.
"""

import hashlib
import json
import math
import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler

ROOT = Path(__file__).resolve().parent.parent
CHINA = timezone(timedelta(hours=8))
BASE = "https://openapi.senoiot.com/open-api"
UNITS = {"AiMiwd": "℃", "AiMisd": "%RH", "AiMifs": "m/s", "AiMiyl": "mm",
         "AiMidqyl": "kPa", "A078": "", "0x05wzktrtem": "℃",
         "0x05wzktrhum": "%", "AiMitrEC": "μS/cm",
         "disinsectizingTemp": "℃", "dryingTemp": "℃", "pestCount": "头"}
SOIL_ZERO = {"0x05wzktrtem", "0x05wzktrhum"}
# 虫情测报灯字符串温度等：厂家 type=string，但仍可解析为数值曲线。
NUMERIC_STRING_PROPS = {"disinsectizingTemp", "dryingTemp", "pestCount"}
PEST_IMAGE_HOSTS = ("store.senoiot.cn", "store.senoiot.com")
# Realtime-only synthetic metrics; vendor history API does not serve these ids.
SYNTHETIC_PROPS = frozenset({"pestCount", "pestSpecies", "pestImage"})


def load_env(path: Path = ROOT / ".env") -> None:
    if path.exists():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            key, sep, value = line.strip().partition("=")
            if sep and key and not key.startswith("#"):
                os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


class VendorError(Exception):
    """Safe public error, never includes URLs, response bodies or credentials."""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise VendorError("厂家接口重定向已拒绝，请核对正式地址")


class Client:
    def __init__(self, account: str, password: str):
        self.account, self.password = account, password
        self.token, self.expires = "", 0.0
        self.opener = build_opener(NoRedirect())

    def _post(self, path: str, params: dict, token: str = "") -> dict:
        if path not in {"auth/login", "device/list", "device/realtime-data",
                        "device/history-data", "product/thing-model"}:
            raise VendorError("只允许只读数据接口")
        request = Request(f"{BASE}/{path}?{urlencode(params)}", data=b"", method="POST",
                          headers={"Content-Type": "application/x-www-form-urlencoded",
                                   **({"X-Api-Token": token} if token else {})})
        try:
            with self.opener.open(request, timeout=20) as response:
                raw = response.read(8_000_001)
            if len(raw) > 8_000_000:
                raise VendorError("厂家响应过大，请缩小时间范围")
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise VendorError("厂家响应格式不正确")
            return result
        except HTTPError as exc:
            if exc.code == 401:
                return {"code": 401, "success": False}
            raise VendorError(f"厂家接口 HTTP {exc.code}") from None
        except (URLError, TimeoutError, OSError):
            raise VendorError("厂家网络暂不可用，将自动重试") from None
        except (ValueError, UnicodeError):
            raise VendorError("厂家响应无法解析") from None

    def login(self):
        result = self._post("auth/login", {"account": self.account, "password": self.password})
        data = result.get("data") or {}
        if result.get("success") is not True or not data.get("token"):
            raise VendorError("厂家登录失败，请核对账号、密码和账号权限")
        self.token = str(data["token"])
        try:
            expiry = datetime.fromisoformat(data["expireTime"])
            self.expires = (expiry if expiry.tzinfo else expiry.replace(tzinfo=CHINA)).timestamp() - 300
        except (ValueError, TypeError, KeyError):
            self.expires = time.time() + 3600

    def call(self, path: str, **params) -> dict:
        if not self.token or time.time() >= self.expires:
            self.login()
        for attempt in range(2):
            result = self._post(path, params, self.token)
            if str(result.get("code")) == "401" and attempt == 0:
                self.login()
                continue
            if result.get("success") is not True:
                raise VendorError("厂家拒绝数据请求，请检查权限或调用限额")
            if not isinstance(result.get("data"), dict):
                raise VendorError("厂家数据结构发生变化")
            return result["data"]
        raise VendorError("厂家认证失效")

    def devices(self):
        records, seen = [], set()
        for page in range(1, 101):
            data = self.call("device/list", current=page, size=100, productCode="",
                             deviceName="", productTypeId="", did="")
            batch = data.get("records")
            if not isinstance(batch, list):
                raise VendorError("设备列表格式不正确")
            for row in batch:
                did = str(row.get("did") or "")
                if not did or did in seen:
                    raise VendorError("设备分页重复或编号缺失，未完成同步")
                seen.add(did)
                records.append(row)
            if len(records) >= int(data.get("total", len(records))):
                return records
            if not batch:
                break
        raise VendorError("设备列表未完整返回")


def parse_china_stamp(value) -> int | None:
    """Parse vendor China-local wall clock into millisecond epoch."""
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        stamp = int(value)
        if 946684800 <= stamp <= 4102444800:
            return stamp * 1000
        if 946684800000 <= stamp <= 4102444800000:
            return stamp
        return None
    text = str(value or "").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return int(datetime.strptime(text, fmt).replace(tzinfo=CHINA).timestamp() * 1000)
        except ValueError:
            continue
    return None


def safe_pest_image_url(url: object) -> str:
    text = str(url or "").strip()
    if not text.startswith(("https://", "http://")):
        return ""
    host = (urlparse(text).hostname or "").lower()
    if host not in PEST_IMAGE_HOSTS and not host.endswith(".senoiot.cn"):
        return ""
    return text


def recognition_records(payload: dict, did: str) -> list[dict]:
    """Turn pest latestRecognition into synthetic read-only samples."""
    recog = payload.get("latestRecognition")
    if not isinstance(recog, dict):
        return []
    stamp = (
        parse_china_stamp(recog.get("recognitionTime"))
        or parse_china_stamp(recog.get("updateTime"))
        or parse_china_stamp(recog.get("createTime"))
        or int(time.time() * 1000)
    )
    rows: list[dict] = []
    num = recog.get("num")
    if num is not None and str(num).strip() != "":
        number = None
        try:
            number = float(num)
            if not math.isfinite(number):
                number = None
        except (TypeError, ValueError):
            number = None
        rows.append({
            "deviceId": did,
            "property": "pestCount",
            "propertyName": "识别虫量",
            "type": "int" if number is not None and number == int(number) else "string",
            "value": int(number) if number is not None and number == int(number) else num,
            "numberValue": number,
            "formatValue": f"{int(number) if number is not None and number == int(number) else num} 头",
            "timestamp": stamp,
        })
    results = recog.get("identifyResult")
    if isinstance(results, list) and results:
        parts = []
        for item in results[:8]:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            qty = str(item.get("quantity") or "").strip()
            parts.append(f"{name}×{qty}" if qty else name)
        if parts:
            label = "、".join(parts)
            rows.append({
                "deviceId": did,
                "property": "pestSpecies",
                "propertyName": "识别种类",
                "type": "string",
                "value": label,
                "formatValue": label,
                "timestamp": stamp,
            })
    image = safe_pest_image_url(recog.get("firstImageUrl") or recog.get("imagePath"))
    if image:
        rows.append({
            "deviceId": did,
            "property": "pestImage",
            "propertyName": "识别图片",
            "type": "file",
            "value": image,
            "formatValue": "有图",
            "timestamp": stamp,
        })
    return rows


def normalized(row: dict, did: str, now_ms: int) -> dict:
    if str(row.get("deviceId", did)) != did:
        raise VendorError("厂家返回的设备编号不匹配")
    prop = str(row.get("property") or "")
    stamp = row.get("timestamp")
    if not prop or isinstance(stamp, bool) or not isinstance(stamp, (int, float)) or not math.isfinite(stamp):
        raise VendorError("数据缺少有效指标或采集时间")
    stamp = int(stamp)
    # Some vendor gateways return Unix seconds while the documented API and
    # storage contract use milliseconds.  Accept only a plausible seconds
    # value, then retain the single millisecond representation internally.
    if 946684800 <= stamp <= (now_ms + 300000) // 1000:
        stamp *= 1000
    if stamp < 946684800000 or stamp > now_ms + 300000:
        raise VendorError("采集时间异常，未写入最新读数")
    value = row.get("value", row.get("numberValue"))
    if value is None and isinstance(row.get("geoValue"), dict):
        value = row.get("geoValue")
    formatted = str(row.get("formatValue") or "")
    # geoPoint / lon-lat objects are valid pest-station readings.
    if isinstance(value, dict) and (
        {"lon", "lat"} <= set(value.keys()) or {"lng", "lat"} <= set(value.keys())
    ):
        lon = value.get("lon", value.get("lng"))
        lat = value.get("lat")
        try:
            lon_f, lat_f = float(lon), float(lat)
            if not (math.isfinite(lon_f) and math.isfinite(lat_f)):
                raise ValueError()
        except (TypeError, ValueError):
            raise VendorError("经纬度格式不正确") from None
        value = {"lon": lon_f, "lat": lat_f}
        formatted = formatted or f"{lon_f},{lat_f}"
    elif isinstance(value, (dict, list)):
        raise VendorError("指标值格式不正确")
    elif isinstance(value, float) and not math.isfinite(value):
        raise VendorError("指标值格式不正确")
    if prop == "pestImage":
        value = safe_pest_image_url(value)
        if not value:
            raise VendorError("识别图片地址不可用")
        formatted = formatted or "有图"
    number = None
    if row.get("type") in {"double", "float", "int", "long", "integer"} and value is not None:
        try:
            number = float(value)
            if not math.isfinite(number):
                raise ValueError()
        except (ValueError, TypeError):
            raise VendorError("数值指标无法解析") from None
    elif prop in NUMERIC_STRING_PROPS and value is not None and not isinstance(value, dict):
        try:
            number = float(value)
            if not math.isfinite(number):
                number = None
        except (ValueError, TypeError):
            number = None
    if not formatted:
        formatted = "—" if value is None else (f"{value.get('lon')},{value.get('lat')}" if isinstance(value, dict) else str(value))
    quality = "MISSING" if value is None else "CHECK_ZERO" if prop in SOIL_ZERO and number == 0 else "UNVERIFIED"
    return {"did": did, "property": prop, "name": str(row.get("propertyName") or prop),
            "value": value, "numeric_value": number, "unit": UNITS.get(prop, ""),
            "formatted": formatted,
            "sample_time": stamp, "quality": quality, "raw": row}


class Store:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS vendor_devices (
                    did TEXT PRIMARY KEY, name TEXT NOT NULL, product_id TEXT,
                    online TEXT, active INTEGER NOT NULL DEFAULT 1,
                    last_sync INTEGER, raw_json TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS vendor_metrics (
                    did TEXT, property TEXT, name TEXT, unit TEXT, model_json TEXT,
                    PRIMARY KEY(did, property));
                CREATE TABLE IF NOT EXISTS vendor_samples (
                    did TEXT, property TEXT, sample_time INTEGER, value_json TEXT,
                    numeric_value REAL, formatted TEXT, quality TEXT, synced_at INTEGER,
                    raw_json TEXT, PRIMARY KEY(did, property, sample_time));
                CREATE TABLE IF NOT EXISTS vendor_cursors (
                    did TEXT, property TEXT, until_ms INTEGER,
                    PRIMARY KEY(did, property));
                CREATE TABLE IF NOT EXISTS vendor_state (key TEXT PRIMARY KEY, value_json TEXT);
            """)

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def state(self, **updates):
        with self.db() as db:
            for key, value in updates.items():
                db.execute("INSERT OR REPLACE INTO vendor_state VALUES (?,?)", (key, json.dumps(value)))
            return {r[0]: json.loads(r[1]) for r in db.execute("SELECT * FROM vendor_state")}

    def devices(self, rows: list[dict], now: int):
        with self.db() as db:
            db.execute("UPDATE vendor_devices SET active=0")
            for row in rows:
                # `ON CONFLICT ... DO UPDATE` needs SQLite >= 3.24, while the
                # deployed ECS image ships an older SQLite. Every column is
                # supplied here, so the longstanding `INSERT OR REPLACE` form
                # has the same result without a schema migration.
                db.execute("INSERT OR REPLACE INTO vendor_devices VALUES (?,?,?,?,1,?,?)",
                           (str(row["did"]), str(row.get("name") or row["did"]), row.get("productId"),
                            str(row.get("onlineStatus", "未知")), now, json.dumps(row, ensure_ascii=False)))

    def ingest(self, did: str, records: list, now: int, cursor: tuple | None = None,
               tolerate_invalid: bool = False) -> list[dict]:
        items, rejected = [], []
        for row in records:
            try:
                items.append(normalized(row, did, now))
            except VendorError as exc:
                if not tolerate_invalid:
                    raise
                rejected.append({"property": str(row.get("property") or ""), "message": str(exc)})
        with self.db() as db:
            for item in items:
                existing = db.execute("""UPDATE vendor_metrics SET name=?,
                    unit=CASE WHEN ?!='' THEN ? ELSE unit END WHERE did=? AND property=?""",
                                      (item["name"], item["unit"], item["unit"], did, item["property"]))
                if existing.rowcount == 0:
                    db.execute("INSERT INTO vendor_metrics(did,property,name,unit) VALUES (?,?,?,?)",
                               (did, item["property"], item["name"], item["unit"]))
                db.execute("INSERT OR REPLACE INTO vendor_samples VALUES (?,?,?,?,?,?,?,?,?)",
                           (did, item["property"], item["sample_time"], json.dumps(item["value"], ensure_ascii=False),
                            item["numeric_value"], item["formatted"], item["quality"], now,
                            json.dumps(item["raw"], ensure_ascii=False)))
            if cursor:
                db.execute("INSERT OR REPLACE INTO vendor_cursors VALUES (?,?,?)", (did, *cursor))
        return rejected

    def model(self, product_id: str, model: dict):
        with self.db() as db:
            for prop in model.get("properties", []):
                # Only enrich observed metrics; a product model is not proof of a fitted sensor.
                db.execute("""UPDATE vendor_metrics SET model_json=?,
                    unit=CASE WHEN unit='' THEN ? ELSE unit END
                    WHERE property=? AND did IN (SELECT did FROM vendor_devices WHERE product_id=?)""",
                           (json.dumps(prop, ensure_ascii=False), prop.get("valueType", {}).get("unit", ""),
                            prop.get("id"), product_id))

    def snapshot(self, stale_seconds: int):
        now = int(time.time() * 1000)
        with self.db() as db:
            devices = []
            for row in db.execute("SELECT did,name,product_id,online,last_sync FROM vendor_devices WHERE active=1 ORDER BY did"):
                device = dict(row)
                readings = db.execute("""SELECT s.*,m.name,m.unit FROM vendor_metrics m
                    JOIN vendor_samples s ON s.did=m.did AND s.property=m.property
                    WHERE m.did=? AND s.sample_time=(SELECT MAX(t.sample_time) FROM vendor_samples t
                        WHERE t.did=m.did AND t.property=m.property) ORDER BY m.property""", (row["did"],)).fetchall()
                device["readings"] = [self.public_sample(r, now, stale_seconds) for r in readings]
                device["status_stale"] = now - (row["last_sync"] or 0) > stale_seconds * 1000
                device["location"] = "未绑定地块"
                devices.append(device)
            return devices

    @staticmethod
    def public_sample(row, now: int, stale_seconds: int):
        item = dict(row)
        item["value"] = json.loads(item.pop("value_json"))
        item.pop("raw_json", None)
        item["stale"] = now - item["sample_time"] > stale_seconds * 1000
        return item

    def history(self, did: str, prop: str, start: int, end: int, limit: int, before: int | None = None):
        with self.db() as db:
            upper = min(end, before - 1) if before is not None else end
            records = db.execute("""SELECT s.*,m.name,m.unit FROM vendor_samples s
                JOIN vendor_metrics m ON m.did=s.did AND m.property=s.property
                WHERE s.did=? AND s.property=? AND sample_time BETWEEN ? AND ?
                ORDER BY sample_time DESC LIMIT ?""", (did, prop, start, upper, limit + 1)).fetchall()
            has_more = len(records) > limit
            records = records[:limit]
            points = [self.public_sample(r, int(time.time()*1000), 300) for r in reversed(records)]
            coverage = db.execute("SELECT until_ms FROM vendor_cursors WHERE did=? AND property=?", (did, prop)).fetchone()
            return {"points": points, "has_more": has_more,
                    "next_before": points[0]["sample_time"] if points and has_more else None,
                    "synced_until": coverage[0] if coverage else None, "source": "senoiot", "mode": "live_readonly"}


class SyncService:
    def __init__(self, store: Store, client: Client | None, *, poll=60, history_interval=300,
                 backfill_hours=1, stale_seconds=300):
        self.store, self.client = store, client
        self.poll, self.history_interval = max(30, poll), max(60, history_interval)
        self.backfill_hours, self.stale_seconds = backfill_hours, stale_seconds
        self.stop_event = threading.Event()
        self.thread = None
        self.history_budget = 0
        self.last_history = 0.0
        self.last_model = 0.0

    def start(self):
        if self.client and not (self.thread and self.thread.is_alive()):
            self.stop_event.clear()
            self.thread = threading.Thread(target=self.run, name="senoiot-sync", daemon=True)
            self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=25)

    def status(self):
        state = self.store.state()
        return {**state, "configured": self.client is not None, "source": "senoiot",
                "mode": "live_readonly", "control_enabled": False,
                "poll_seconds": self.poll, "history_seconds": self.history_interval,
                "stale_seconds": self.stale_seconds,
                "running": bool(self.thread and self.thread.is_alive()),
                "status": state.get("status", "waiting") if self.client else "not_configured"}

    def realtime(self):
        devices = self.client.devices()
        self.store.devices(devices, int(time.time()*1000))
        errors, rejected_samples = [], []
        for device in devices:
            if self.stop_event.is_set():
                return
            did = str(device["did"])
            try:
                data = self.client.call("device/realtime-data", deviceId=did)
                records = data.get("deviceData", {}).get("result")
                if not isinstance(records, list):
                    records = []
                records = list(records) + recognition_records(data, did)
                if not records:
                    raise VendorError("设备暂未返回属性读数")
                rejected = self.store.ingest(did, records, int(time.time()*1000), tolerate_invalid=True)
                rejected_samples.extend({"device": did, **item} for item in rejected)
            except VendorError as exc:
                errors.append({"device": did, "message": str(exc)})
        self.store.state(status="degraded" if errors else "healthy", errors=errors,
                         rejected_samples=rejected_samples,
                         last_poll=int(time.time()*1000),
                         **({"last_success": int(time.time()*1000)} if not errors else {}))
        if time.monotonic() - self.last_model > 3600:
            for product in {d.get("productId") for d in devices if d.get("productId")}:
                try:
                    self.store.model(product, self.client.call("product/thing-model", productId=product))
                except VendorError:
                    pass  # Actual observations remain usable without optional metadata.
            self.last_model = time.monotonic()

    def history_window(self, did: str, prop: str, start: int, end: int,
                       warnings: list[dict] | None = None):
        if self.stop_event.is_set() or self.history_budget <= 0:
            raise VendorError("本轮补数达到调用预算，下轮继续")
        self.history_budget -= 1
        params = {"deviceId": did, "property": prop, "pageIndex": 1, "pageSize": 100,
                  "startTime": datetime.fromtimestamp(start/1000, CHINA).strftime("%Y-%m-%d %H:%M:%S"),
                  "endTime": datetime.fromtimestamp(end/1000, CHINA).strftime("%Y-%m-%d %H:%M:%S")}
        data = self.client.call("device/history-data", **params)
        records, total = data.get("records"), data.get("total")
        if not isinstance(records, list) or not isinstance(total, int) or total < 0:
            raise VendorError("历史数据结构不完整，未推进进度")
        if total > len(records):
            if end - start <= 1000:
                raise VendorError("一秒内历史记录超过上限，需要厂家修复分页")
            middle = ((start + end)//2000)*1000
            return (self.history_window(did, prop, start, middle, warnings)
                    + self.history_window(did, prop, middle+1000, end, warnings))
        if total != len(records):
            raise VendorError("历史数量不一致，未推进进度")
        accepted, keys = [], set()
        for row in records:
            try:
                item = normalized(row, did, int(time.time()*1000))
            except VendorError as exc:
                if warnings is not None:
                    warnings.append({"device": did, "property": str(row.get("property") or ""),
                                     "message": str(exc)})
                continue
            if item["property"] != prop or not start <= item["sample_time"] <= end+999:
                raise VendorError("厂家历史筛选未生效，未推进进度")
            key = (item["property"], item["sample_time"])
            if key in keys:
                raise VendorError("历史记录重复，未推进进度")
            keys.add(key)
            accepted.append(row)
        if len(keys) != len(accepted):
            raise VendorError("历史记录重复，未推进进度")
        return accepted

    def history(self):
        end = int(time.time())*1000 - 60000  # Leave time for late vendor writes.
        self.history_budget = 40
        with self.store.db() as db:
            jobs = db.execute("""SELECT m.did,m.property,c.until_ms FROM vendor_metrics m
                JOIN vendor_devices d ON d.did=m.did AND d.active=1
                LEFT JOIN vendor_cursors c ON c.did=m.did AND c.property=m.property
                ORDER BY COALESCE(c.until_ms,0),m.did,m.property""").fetchall()
        errors, warnings = [], []
        for job in jobs:
            if job["property"] in SYNTHETIC_PROPS:
                continue
            start = (job["until_ms"] - 120000) if job["until_ms"] else end - self.backfill_hours*3600000
            start = (start//1000)*1000
            while start < end:
                until = min(end, start+1800000)
                try:
                    records = self.history_window(job["did"], job["property"], start, until, warnings)
                    self.store.ingest(job["did"], records, int(time.time()*1000), (job["property"], until))
                    start = until
                except VendorError as exc:
                    errors.append({"device": job["did"], "property": job["property"], "message": str(exc)})
                    break
            if self.history_budget <= 0 or self.stop_event.is_set():
                break
        self.store.state(history_errors=errors, history_warnings=warnings,
                         last_history_poll=int(time.time()*1000))

    def run(self):
        failures = 0
        while not self.stop_event.is_set():
            started = time.monotonic()
            try:
                self.realtime()
                if time.monotonic() - self.last_history >= self.history_interval:
                    self.history()
                    self.last_history = time.monotonic()
                failures = 0
            except Exception as exc:
                failures += 1
                message = str(exc) if isinstance(exc, VendorError) else "同步暂时失败，将自动重试"
                self.store.state(status="error", errors=[{"message": message}], last_attempt=int(time.time()*1000))
            delay = min(900, self.poll * 2**min(failures, 4))
            self.stop_event.wait(max(1, delay-(time.monotonic()-started)))


def from_environment() -> SyncService:
    account, password = os.getenv("SENOIOT_ACCOUNT", ""), os.getenv("SENOIOT_PASSWORD", "")
    scope = hashlib.sha256(account.encode()).hexdigest()[:16] if account else "unconfigured"
    path = Path(os.getenv("SENOIOT_DB_PATH", str(ROOT / "data" / f"telemetry-{scope}.db")))
    enabled = os.getenv("SENOIOT_ENABLED", "0") == "1"
    client = Client(account, password) if enabled and account and password else None
    return SyncService(Store(path), client,
                       poll=int(os.getenv("SENOIOT_POLL_SECONDS", "60")),
                       history_interval=int(os.getenv("SENOIOT_HISTORY_SECONDS", "300")),
                       backfill_hours=max(1, min(720, int(os.getenv("SENOIOT_BACKFILL_HOURS", "1")))),
                       stale_seconds=max(60, int(os.getenv("SENOIOT_STALE_SECONDS", "1800"))))
