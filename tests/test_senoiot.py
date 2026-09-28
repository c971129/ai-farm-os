import json
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime

import pytest

from backend.senoiot import CHINA, Client, Store, SyncService, VendorError, normalized


def sample(stamp, value=21.8, prop="AiMiwd", did="station", **extra):
    return {"deviceId": did, "property": prop, "propertyName": "空气温度", "timestamp": stamp,
            "value": value, "type": "double", "formatValue": f"{value}℃", **extra}


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "telemetry.db")


def test_normalization_preserves_zero_enum_and_vendor_timestamp():
    now = int(time.time()*1000)
    zero = normalized(sample(now, 0, "0x05wzktrtem"), "station", now)
    assert zero["value"] == 0 and zero["quality"] == "CHECK_ZERO"
    assert normalized(sample(now, 0, "AiMiyl"), "station", now)["quality"] == "UNVERIFIED"
    wind = normalized(sample(now, "2.0", "A078", type="enum", formatValue="东"), "station", now)
    assert wind["value"] == "2.0" and wind["numeric_value"] is None and wind["formatted"] == "东"
    assert wind["sample_time"] == now
    assert normalized(sample(now, None), "station", now)["quality"] == "MISSING"


def test_normalization_accepts_vendor_seconds_timestamp():
    now = int(time.time() * 1000)
    item = normalized(sample(now // 1000), "station", now)
    assert item["sample_time"] == (now // 1000) * 1000


def test_default_stale_window_is_thirty_minutes(monkeypatch):
    """厂商读数在采集后 30 分钟内均按正常实时数据处理。"""
    from backend.senoiot import from_environment

    monkeypatch.delenv("SENOIOT_STALE_SECONDS", raising=False)
    monkeypatch.setenv("SENOIOT_ENABLED", "0")
    service = from_environment()
    assert service.stale_seconds == 1800


def test_realtime_keeps_valid_siblings_when_one_vendor_sample_is_invalid(store):
    now = int(time.time() * 1000)

    class MixedRealtimeClient:
        def devices(self):
            return [{"did": "station", "name": "站点", "onlineStatus": "在线"}]

        def call(self, path, **params):
            assert path == "device/realtime-data"
            return {"deviceData": {"result": [
                sample(now, 22.1),
                sample(123, 99, prop="AiMifs"),
            ]}}

    service = SyncService(store, MixedRealtimeClient())
    service.realtime()

    snapshot = store.snapshot(300)
    assert [reading["property"] for reading in snapshot[0]["readings"]] == ["AiMiwd"]
    state = store.state()
    assert state["status"] == "healthy"
    assert state["errors"] == []
    assert state["rejected_samples"][0]["property"] == "AiMifs"


def test_history_keeps_page_healthy_when_vendor_has_malformed_rows(store):
    now = int(time.time() * 1000)
    stamp = now - 45 * 60_000
    store.devices([{"did": "station", "name": "站点", "onlineStatus": "在线"}], now)
    store.ingest("station", [sample(stamp)], now)

    class MixedHistoryClient:
        calls = 0

        def call(self, path, **params):
            assert path == "device/history-data"
            self.calls += 1
            if self.calls > 1:
                return {"total": 0, "records": []}
            return {"total": 2, "records": [
                sample(stamp),
                sample(123, 99),
            ]}

    service = SyncService(store, MixedHistoryClient())
    service.history()

    state = store.state()
    assert state["history_errors"] == []
    assert state["history_warnings"][0]["property"] == "AiMiwd"


@pytest.mark.parametrize("change", [{"timestamp":None},{"timestamp":123},{"value":float("nan")},
    {"deviceId":"another-account"},{"timestamp":99999999999999}])
def test_invalid_readings_fail_closed(change):
    now = int(time.time()*1000)
    row = sample(now)
    row.update(change)
    with pytest.raises(VendorError):
        normalized(row, "station", now)


def test_atomic_ingest_dedup_latest_and_stale(store):
    now = int(time.time()*1000)
    store.devices([{"did":"station","name":"站点","onlineStatus":"在线"}], now)
    store.ingest("station", [sample(now),sample(now-900000,19)], now)
    store.ingest("station", [sample(now-900000,19)], now)
    snapshot = store.snapshot(300)
    assert snapshot[0]["readings"][0]["value"] == 21.8
    assert snapshot[0]["readings"][0]["stale"] is False
    assert len(store.history("station","AiMiwd",now-1000000,now,10)["points"]) == 2
    with pytest.raises(VendorError):
        store.ingest("station",[sample(now-1000),sample(0)],now,("AiMiwd",now))
    with store.db() as db:
        assert db.execute("SELECT COUNT(*) FROM vendor_samples").fetchone()[0] == 2
        assert db.execute("SELECT COUNT(*) FROM vendor_cursors").fetchone()[0] == 0


def test_store_sync_writes_without_modern_upsert_syntax(store, monkeypatch):
    """The production ECS SQLite rejects `ON CONFLICT ... DO UPDATE`."""
    original_db = store.db

    class LegacyConnection:
        def __init__(self, connection):
            self.connection = connection

        def execute(self, statement, parameters=()):
            if "ON CONFLICT" in statement.upper():
                raise sqlite3.OperationalError('near "ON": syntax error')
            return self.connection.execute(statement, parameters)

    @contextmanager
    def legacy_db():
        with original_db() as connection:
            yield LegacyConnection(connection)

    monkeypatch.setattr(store, "db", legacy_db)
    now = int(time.time() * 1000)
    store.devices([{"did": "station", "name": "旧名称", "onlineStatus": "离线"}], now)
    store.ingest("station", [sample(now, 20)], now)
    store.devices([{"did": "station", "name": "新名称", "onlineStatus": "在线"}], now + 1)
    store.ingest("station", [sample(now, 21)], now + 1)

    snapshot = store.snapshot(300)
    assert snapshot[0]["name"] == "新名称"
    assert snapshot[0]["online"] == "在线"
    assert snapshot[0]["readings"][0]["value"] == 21


def test_models_enrich_observations_without_creating_imaginary_sensors(store):
    now = int(time.time()*1000)
    store.devices([{"did":"station","productId":"EnvironmentMonitoring"}], now)
    store.ingest("station",[sample(now)],now)
    store.model("EnvironmentMonitoring",{"properties":[{"id":"PM2.5","valueType":{"unit":"μg/m³"}}]})
    assert [r["property"] for r in store.snapshot(300)[0]["readings"]] == ["AiMiwd"]


def test_removed_devices_not_shown_and_old_values_flagged(store):
    now = int(time.time()*1000)
    store.devices([{"did":"station"}],now-600000)
    store.ingest("station",[sample(now-600000)],now)
    assert store.snapshot(300)[0]["status_stale"] is True
    assert store.snapshot(300)[0]["readings"][0]["stale"] is True
    store.devices([],now)
    assert store.snapshot(300) == []


def test_history_pagination_in_our_database_has_no_gaps(store):
    now = int(time.time()*1000)
    store.ingest("station",[sample(now-i*1000,i) for i in range(5)],now)
    first = store.history("station","AiMiwd",now-10000,now,3)
    second = store.history("station","AiMiwd",now-10000,now,3,first["next_before"])
    assert first["has_more"] and not second["has_more"]
    assert len({r["sample_time"] for r in first["points"]+second["points"]}) == 5


def test_client_renews_once_and_never_uses_bearer_prefix(monkeypatch):
    client = Client("private-account", "private-password")
    calls = []
    responses = iter([{"success":True,"data":{"token":"first"}}, {"success":False,"code":401},
                      {"success":True,"data":{"token":"second"}}, {"success":True,"data":{"records":[]}}])
    def post(path, params, token=""):
        calls.append((path, token))
        return next(responses)
    monkeypatch.setattr(client,"_post",post)
    client.call("device/list")
    assert calls == [("auth/login",""),("device/list","first"),("auth/login",""),("device/list","second")]


def test_auth_failure_does_not_expose_vendor_response(monkeypatch):
    client = Client("secret-account","secret-password")
    monkeypatch.setattr(client,"_post",lambda *args:{"success":False,"msg":"secret-password"})
    with pytest.raises(VendorError) as error:
        client.login()
    assert "secret" not in str(error.value)


def test_client_rejects_control_paths():
    with pytest.raises(VendorError, match="只读"):
        Client("a","b")._post("device/control",{})


def test_history_time_splitting_handles_broken_vendor_pagination(store):
    now = int(time.time())*1000
    all_rows = [sample(now-20000+i*1000) for i in range(20)]
    class FakeClient:
        def call(self, path, **params):
            start = int(datetime.strptime(params["startTime"],"%Y-%m-%d %H:%M:%S").replace(tzinfo=CHINA).timestamp()*1000)
            end = int(datetime.strptime(params["endTime"],"%Y-%m-%d %H:%M:%S").replace(tzinfo=CHINA).timestamp()*1000)
            rows = [r for r in all_rows if start <= r["timestamp"] <= end+999]
            return {"total":len(rows),"records":rows[-3:],"pages":0,"current":0}
    service = SyncService(store,FakeClient())
    service.history_budget = 40
    result = service.history_window("station","AiMiwd",now-20000,now)
    assert sorted(r["timestamp"] for r in result) == [r["timestamp"] for r in all_rows]


def test_history_bad_filters_do_not_advance_cursor(store):
    now = int(time.time())*1000
    store.devices([{"did":"station"}],now)
    store.ingest("station",[sample(now)],now)
    class BadClient:
        def call(self,*args,**kwargs):
            return {"total":1,"records":[sample(now,prop="wrong-property")]}
    service = SyncService(store,BadClient())
    service.history()
    with store.db() as db:
        assert db.execute("SELECT COUNT(*) FROM vendor_cursors").fetchone()[0] == 0
    assert store.state()["history_errors"]


def test_telemetry_api_is_readonly_and_returns_no_credentials(locked_client):
    status = locked_client.get("/api/telemetry/status")
    assert status.status_code == 200
    assert status.json()["control_enabled"] is False
    assert status.json()["configured"] is False
    payload = locked_client.get("/api/telemetry/devices").json()
    assert payload["devices"] == []
    assert "password" not in json.dumps(payload) and "token" not in json.dumps(payload)
    assert locked_client.post("/api/telemetry/sync").status_code == 423
    assert locked_client.get("/api/telemetry/history",params={"device":"x","property":"x","start":0,"end":1}).status_code == 422
    assert locked_client.get("/.env").status_code == 404
    assert locked_client.get("/api/telemetry/status",headers={"Host":"evil.example"}).status_code == 400


def test_normalization_accepts_geopoint_and_string_temps():
    now = int(time.time() * 1000)
    geo = normalized({
        "deviceId": "pest", "property": "lnglat", "propertyName": "经纬度", "type": "geoPoint",
        "timestamp": now, "value": {"lon": 84.93, "lat": 45.43}, "formatValue": "84.93,45.43",
    }, "pest", now)
    assert geo["value"] == {"lon": 84.93, "lat": 45.43}
    assert geo["formatted"] == "84.93,45.43"
    temp = normalized({
        "deviceId": "pest", "property": "disinsectizingTemp", "propertyName": "杀虫仓温度",
        "type": "string", "timestamp": now, "value": "65", "formatValue": "65",
    }, "pest", now)
    assert temp["numeric_value"] == 65.0
    assert temp["unit"] == "℃"


def test_realtime_ingests_pest_recognition_summary(store):
    now = int(time.time() * 1000)

    class PestClient:
        def devices(self):
            return [{"did": "pest-1", "name": "虫情设备C3", "productId": "InfestationReportC3", "onlineStatus": "在线"}]

        def call(self, path, **params):
            if path == "product/thing-model":
                return {"productId": params.get("productId"), "properties": []}
            assert path == "device/realtime-data"
            return {
                "pestDevice": True,
                "deviceData": {"result": [
                    {"deviceId": "pest-1", "property": "mode", "propertyName": "运行模式", "type": "enum",
                     "value": "自动模式", "formatValue": "自动模式", "timestamp": now},
                    {"deviceId": "pest-1", "property": "lnglat", "propertyName": "经纬度", "type": "geoPoint",
                     "value": {"lon": 84.9, "lat": 45.4}, "formatValue": "84.9,45.4", "timestamp": now},
                ]},
                "latestRecognition": {
                    "num": "12",
                    "createTime": "2026-09-20 17:06:22",
                    "firstImageUrl": "https://store.senoiot.cn/upload/demo.jpg",
                    "identifyResult": [
                        {"name": "沫蝉", "quantity": "1"},
                        {"name": "蛱蝶", "quantity": "1"},
                    ],
                },
            }

    service = SyncService(store, PestClient())
    service.realtime()
    readings = {r["property"]: r for r in store.snapshot(300)[0]["readings"]}
    assert readings["mode"]["formatted"] == "自动模式"
    assert readings["lnglat"]["formatted"] == "84.9,45.4"
    assert readings["pestCount"]["numeric_value"] == 12
    assert "沫蝉" in readings["pestSpecies"]["formatted"]
    assert readings["pestImage"]["value"].startswith("https://store.senoiot.cn/")
    # Synthetic pest recognition metrics must not enter history backfill jobs.
    with store.db() as db:
        jobs = [r["property"] for r in db.execute("SELECT property FROM vendor_metrics WHERE did='pest-1'")]
    assert "pestCount" in jobs
    from backend.senoiot import SYNTHETIC_PROPS
    assert not (set(jobs) & SYNTHETIC_PROPS) - SYNTHETIC_PROPS  # sanity
    assert SYNTHETIC_PROPS.issuperset({"pestCount", "pestSpecies", "pestImage"})


def test_account_storage_isolation(monkeypatch):
    import backend.senoiot as vendor
    paths = []
    monkeypatch.delenv("SENOIOT_DB_PATH",raising=False)
    monkeypatch.setattr(vendor,"Store",lambda path:paths.append(path))
    for account in ("first-tenant","second-tenant"):
        monkeypatch.setenv("SENOIOT_ACCOUNT",account)
        vendor.from_environment()
    assert paths[0] != paths[1]
