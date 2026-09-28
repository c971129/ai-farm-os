from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("AI_FARM_DB_PATH", str(ROOT / "data" / "farm.db"))).expanduser().resolve()
DATA_DIR = DB_PATH.parent

# 与 frontend/assets/engine.js 及 docs/FINAL_SPEC.md 对齐的种子数据
LAND_SEED = [
    # code, name, area, soil, health, moisture, n, p, k, temp, pest, crop, variety, stage, yield, growth, pts
    ("A-01", "北区一号田", 280, "砂壤土", 90, 26.8, 40, 17, 34, 24.2, 16, "棉花", "新陆中67", "吐絮盛期", 455, 88, [80, 80, 240, 80, 240, 180, 80, 180]),
    ("A-02", "北区二号田", 260, "壤土", 86, 25.4, 38, 16, 31, 24.6, 22, "棉花", "新陆中67", "吐絮盛期", 468, 85, [260, 80, 420, 80, 420, 180, 260, 180]),
    ("B-01", "中区棉花田", 340, "黏壤土", 82, 23.6, 42, 15, 28, 25.1, 28, "棉花", "新陆早61", "吐絮盛期", 442, 83, [80, 210, 280, 210, 280, 330, 80, 330]),
    ("B-02", "中区玉米田", 310, "壤土", 93, 19.8, 46, 19, 38, 23.4, 10, "玉米", "郑单958", "成熟期", 720, 94, [300, 210, 500, 210, 500, 330, 300, 330]),
    ("C-01", "南区小麦田", 420, "砂壤土", 84, 21.2, 34, 16, 30, 22.8, 12, "小麦", "新冬20", "适播准备", 430, 78, [80, 360, 300, 360, 300, 500, 80, 500]),
    ("C-02", "南区轮作田", 390, "壤土", 87, 27.5, 41, 17, 33, 24.0, 18, "玉米", "先玉335", "乳熟期", 660, 89, [320, 360, 540, 360, 540, 500, 320, 500]),
]

DEVICE_SEED = [
    # code, name, type, status, loc, value, mqtt, x, y, battery
    ("WX-001", "场部气象站·WXT536", "weather", "场景状态 · 在线", "场部", "气温 24.5℃ / 风速 2.1m/s · 相对湿度 48%", "farm/1/device/WX-001/data", 280, 190, 100),
    ("RAIN-001", "称重雨量计·Pluvio2L", "rain", "场景状态 · 在线", "场部", "累计降水 12.4mm · 雨强 1.8mm/h", "farm/1/device/RAIN-001/data", 295, 205, 100),
    ("SOIL-001", "TEROS12墒情·A-01", "sensor", "场景状态 · 在线", "A-01", "VWC 31.2% · 土温 23.1℃ · EC 1.28 dS/m @20cm", "farm/1/device/SOIL-001/data", 150, 120, 91),
    ("SOIL-002", "TEROS12墒情·B-01", "sensor", "场景状态 · 在线", "B-01", "VWC 18.4% · 土温 25.2℃ · EC 1.55 dS/m @20cm", "farm/1/device/SOIL-002/data", 170, 260, 86),
    ("FLOW-001", "超声波水表·Octave", "irrigation", "场景状态 · 在线", "场部泵房", "流量 12.6 m³/h · 累计 1864 m³", "farm/1/device/FLOW-001/cmd", 215, 305, 100),
    ("PUMP-001", "智能水泵001", "irrigation", "场景状态 · 待机", "场部泵房", "秋收窗口暂停轮灌", "farm/1/device/PUMP-001/cmd", 200, 290, 100),
    ("VALVE-012", "电磁阀012", "irrigation", "场景状态 · 关闭", "A-02", "阀位 0%", "farm/1/device/VALVE-012/cmd", 340, 140, 100),
    ("UAV-002", "多光谱测绘·Mavic3M", "drone", "场景状态 · 巡田回放", "B-02", "NDVI 航测完成 · 电量 88% · RTK 固定", "farm/1/device/UAV-002/cmd", 400, 260, 88),
    ("UAV-001", "植保无人机001", "drone", "场景状态 · 编队回放", "B-01", "电量 81% / 脱叶航线", "farm/1/device/UAV-001/cmd", 190, 255, 81),
    ("PEST-001", "AI虫情诱捕·Trapview", "pest", "场景状态 · 在线", "B-01", "日虫压 18 头 · 棉铃虫成虫高峰窗口", "farm/1/device/PEST-001/data", 230, 280, 74),
    ("YIELD-001", "测产系统·InCommand", "yield", "场景状态 · 整备", "B-02", "产量 6820 kg/ha · 含水 18.6%", "farm/1/device/YIELD-001/data", 380, 280, 100),
    ("TRACTOR-001", "无人拖拉机001", "tractor", "场景状态 · 整备", "C-01", "油量 71% · 冬麦播前整地", "farm/1/device/TRACTOR-001/cmd", 200, 430, 71),
    ("ROBOT-001", "田间机器人001", "robot", "场景状态 · 待命", "A-01", "电量 90%", "farm/1/device/ROBOT-001/cmd", 120, 150, 90),
]

DEVICE_VENDOR_BY_CODE = {
    "WX-001": "vaisala", "RAIN-001": "ott", "SOIL-001": "meter", "SOIL-002": "meter",
    "FLOW-001": "netafim", "PUMP-001": "huade", "VALVE-012": "huade", "UAV-001": "dji",
    "UAV-002": "dji", "PEST-001": "trapview", "YIELD-001": "agleader",
    "TRACTOR-001": "lovol", "ROBOT-001": "xinjie",
}


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _cols(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def _ensure_columns(conn: sqlite3.Connection) -> None:
    land_cols = {
        "n": "REAL DEFAULT 0",
        "p": "REAL DEFAULT 0",
        "k": "REAL DEFAULT 0",
        "temp": "REAL DEFAULT 22",
        "pest_risk": "INTEGER DEFAULT 20",
        "growth": "INTEGER DEFAULT 80",
    }
    existing = _cols(conn, "lands")
    for name, decl in land_cols.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE lands ADD COLUMN {name} {decl}")

    device_cols = {
        "mqtt": "TEXT",
        "pos_x": "REAL DEFAULT 0",
        "pos_y": "REAL DEFAULT 0",
        "battery": "INTEGER DEFAULT 100",
        "vendor_id": "TEXT DEFAULT 'unassigned'",
    }
    existing = _cols(conn, "devices")
    for name, decl in device_cols.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE devices ADD COLUMN {name} {decl}")

    agent_cols = {
        "memory": "TEXT DEFAULT '[]'",
        "tools": "TEXT DEFAULT '[]'",
        "score": "REAL DEFAULT 90",
    }
    existing = _cols(conn, "agents")
    for name, decl in agent_cols.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE agents ADD COLUMN {name} {decl}")

    task_cols = {"priority": "TEXT DEFAULT '中'"}
    existing = _cols(conn, "farm_tasks")
    for name, decl in task_cols.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE farm_tasks ADD COLUMN {name} {decl}")

    plan_cols = {
        "status": "TEXT DEFAULT '待执行'",
        "calculation_status": "TEXT DEFAULT 'NOT_CALCULATED'",
    }
    existing = _cols(conn, "irrigation_plans")
    for name, decl in plan_cols.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE irrigation_plans ADD COLUMN {name} {decl}")

    asset_cols = {"market": "TEXT"}
    existing = _cols(conn, "data_assets")
    for name, decl in asset_cols.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE data_assets ADD COLUMN {name} {decl}")

    farm_cols = {"edge_nodes": "INTEGER DEFAULT 3", "mqtt_online": "INTEGER DEFAULT 1"}
    existing = _cols(conn, "farms")
    for name, decl in farm_cols.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE farms ADD COLUMN {name} {decl}")


def _sync_demo_contract(conn: sqlite3.Connection) -> None:
    """Keep the bundled demo snapshot aligned with the browser engine.

    Production deployments must use a separate database and set
    AI_FARM_SYNC_DEMO_CONTRACT=0; this migration only targets the bundled demo.
    """
    if os.environ.get("AI_FARM_SYNC_DEMO_CONTRACT", "1") != "1":
        return
    if conn.execute("SELECT COUNT(*) FROM farms").fetchone()[0] != 1:
        return
    for row in LAND_SEED:
        code, name, area, soil, health, moisture, n, p, k, temp, pest, crop, variety, stage, yld, growth, pts = row
        ring = [pts[i : i + 2] for i in range(0, len(pts), 2)]
        if ring and ring[0] != ring[-1]:
            ring.append(ring[0])
        geo = json.dumps({"type": "Polygon", "coordinates": [ring]}, ensure_ascii=False)
        conn.execute(
            """
            UPDATE lands SET name=?, area_mu=?, soil_type=?, health_index=?, moisture=?, n=?, p=?, k=?,
                temp=?, pest_risk=?, growth=?, geojson=? WHERE code=?
            """,
            (name, area, soil, health, moisture, n, p, k, temp, pest, growth, geo, code),
        )
        conn.execute(
            """
            UPDATE crops SET name=?, variety=?, stage=?, expected_yield=?
            WHERE land_id=(SELECT id FROM lands WHERE code=? LIMIT 1)
            """,
            (crop, variety, stage, yld, code),
        )
    conn.execute("UPDATE farms SET status = '沙箱模式', mqtt_online = 0")
    conn.execute("UPDATE devices SET last_value = '模拟 · ' || last_value WHERE last_value NOT LIKE '模拟 · %'")
    conn.execute("UPDATE devices SET status = '场景状态 · ' || status WHERE status NOT LIKE '场景状态 · %'")
    for code, vendor_id in DEVICE_VENDOR_BY_CODE.items():
        conn.execute("UPDATE devices SET vendor_id=? WHERE code=?", (vendor_id, code))

    task_updates = {
        "北区滴灌阀组巡检": ("北区滴灌阀组现场核验", "待人工确认", "模拟 2026-09-12 08:00"),
        "中区棉花无人机巡田": ("中区棉花调查航线登记", "待人工确认", "模拟 2026-09-12 10:30"),
        "南区追肥方案确认": ("南区水肥证据补全", "待审核", "待证据齐全"),
        "无人农机深松作业": ("无人农机深松条件复核", "待审核", "待边界/道路/机手确认"),
        "产量预测周报": ("产量预测周报模拟", "已完成", "模拟 2026-09-11 18:00"),
    }
    for old_title, (new_title, status, scheduled_at) in task_updates.items():
        conn.execute(
            "UPDATE farm_tasks SET title=?, status=?, scheduled_at=? WHERE title=?",
            (new_title, status, scheduled_at, old_title),
        )

    agent_updates = {
        "Farm Master Agent": ("规则分析", "已生成编排草稿，等待人工复核", ["回放队列", "不生成设备命令"]),
        "Crop Expert Agent": ("规则分析", "模拟指标仅触发补证，不形成生产结论", ["本地阈值待核实", "处方需人工批准"]),
        "Irrigation Agent": ("规则分析", "关键水量输入不完整，处方 NO_GO", ["节水 20% 为目标值", "田间持水量与 ETc 待补"]),
        "Vision Agent": ("规则分析", "关键词规则仿真，等待原始影像与验证集", ["样本量为界面模拟", "89.5% 为待验证目标"]),
        "Robot Agent": ("安全锁定", "高风险动作缺证据，未生成设备命令", ["设备 ACK 未接入", "边界与人员隔离待核验"]),
        "Yield Agent": ("规则分析", "仿真产量估算尚无本场测产校准", ["历史基线为模拟", "实收校准待导入"]),
        "Finance Agent": ("规则分析", "增收为目标区间，缺基线与成本台账", ["节水减药目标", "成本与价格待导入"]),
    }
    for name, (status, action, memory) in agent_updates.items():
        conn.execute(
            "UPDATE agents SET status=?, last_action=?, memory=?, score=0 WHERE name=?",
            (status, action, json.dumps(memory, ensure_ascii=False), name),
        )

    conn.execute(
        """
        UPDATE irrigation_plans
        SET water_mm=NULL, calculation_status='NOT_CALCULATED', fertilizer='候选处方；实际肥料与剂量未计算',
            reason='缺田间持水量、根层、ETc、有效降雨、效率和传感器 QC',
            status='NO_GO · 待补证据'
        WHERE land_code='B-01' AND water_mm=18 AND status='待执行'
        """
    )
    conn.execute(
        "UPDATE irrigation_plans SET water_mm=NULL, calculation_status='NOT_CALCULATED' WHERE status LIKE 'NO_GO%'"
    )
    conn.execute(
        "UPDATE robot_missions SET mission='B-01/B-02 调查航线仿真', status='待人工确认', eta='待空域/天气/返航点核验' WHERE mission='B-01/B-02 航线巡田'"
    )
    conn.execute(
        "UPDATE robot_missions SET mission='C-02 深松候选路线', status='NO_GO', eta='待边界/道路/机手确认' WHERE mission='C-02 深松 25cm'"
    )
    conn.execute(
        "UPDATE robot_missions SET mission='A-01 局部补施候选处方', status='NO_GO', eta='待农艺与现场证据' WHERE mission='A-01 局部补施'"
    )

    model_updates = {
        "AgrLLM-Farm-7B": ("v2.4-demo", "仿真模型", "可用率目标 93% · 未验证"),
        "PestVision-X": ("v3.1-demo", "仿真模型", "准确率目标 89.5% · 无本场验证集"),
        "YieldPredict-V3": ("v3.2-demo", "仿真模型", "RMSE 目标 18.6 kg/亩 · 未校准"),
        "IrrigateOpt": ("v1.8-demo", "仿真模型", "节水目标约 20% · 待基线核验"),
    }
    for name, (version, status, metric) in model_updates.items():
        conn.execute(
            "UPDATE models SET version=?, status=?, metric=? WHERE name=?",
            (version, status, metric, name),
        )
    conn.commit()

def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS farms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            region TEXT,
            area_mu REAL,
            crop_focus TEXT,
            status TEXT,
            edge_nodes INTEGER DEFAULT 3,
            mqtt_online INTEGER DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS lands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            farm_id INTEGER,
            code TEXT,
            name TEXT,
            area_mu REAL,
            soil_type TEXT,
            health_index INTEGER,
            moisture REAL,
            n REAL DEFAULT 0,
            p REAL DEFAULT 0,
            k REAL DEFAULT 0,
            temp REAL DEFAULT 22,
            pest_risk INTEGER DEFAULT 20,
            growth INTEGER DEFAULT 80,
            geojson TEXT,
            FOREIGN KEY(farm_id) REFERENCES farms(id)
        );
        CREATE TABLE IF NOT EXISTS crops (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            land_id INTEGER,
            name TEXT,
            variety TEXT,
            stage TEXT,
            planted_at TEXT,
            expected_yield REAL,
            FOREIGN KEY(land_id) REFERENCES lands(id)
        );
        CREATE TABLE IF NOT EXISTS farm_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            farm_id INTEGER,
            title TEXT,
            task_type TEXT,
            land_code TEXT,
            assignee TEXT,
            status TEXT,
            scheduled_at TEXT,
            priority TEXT DEFAULT '中'
        );
        CREATE TABLE IF NOT EXISTS devices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            farm_id INTEGER,
            code TEXT,
            name TEXT,
            device_type TEXT,
            status TEXT,
            location TEXT,
            last_value TEXT,
            mqtt TEXT,
            pos_x REAL DEFAULT 0,
            pos_y REAL DEFAULT 0,
            battery INTEGER DEFAULT 100
            ,vendor_id TEXT DEFAULT 'unassigned'
        );
        CREATE TABLE IF NOT EXISTS sensor_readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id INTEGER,
            metric TEXT,
            value REAL,
            unit TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS agents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            role TEXT,
            status TEXT,
            last_action TEXT,
            memory TEXT DEFAULT '[]',
            tools TEXT DEFAULT '[]',
            score REAL DEFAULT 90
        );
        CREATE TABLE IF NOT EXISTS agent_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id INTEGER,
            goal TEXT,
            status TEXT,
            result TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS irrigation_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            land_code TEXT,
            water_mm REAL,
            fertilizer TEXT,
            reason TEXT,
            status TEXT DEFAULT '待执行',
            calculation_status TEXT DEFAULT 'NOT_CALCULATED',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS data_assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            asset_type TEXT,
            volume TEXT,
            owner TEXT,
            value_note TEXT,
            market TEXT
        );
        CREATE TABLE IF NOT EXISTS robot_missions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device TEXT,
            mission TEXT,
            status TEXT,
            progress INTEGER DEFAULT 0,
            eta TEXT
        );
        CREATE TABLE IF NOT EXISTS knowledge (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            source TEXT,
            snippet TEXT
        );
        CREATE TABLE IF NOT EXISTS models (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            type TEXT,
            version TEXT,
            status TEXT,
            metric TEXT
        );
        CREATE TABLE IF NOT EXISTS app_state (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS audit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id TEXT NOT NULL UNIQUE,
            farm_id INTEGER,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            resource_type TEXT NOT NULL,
            resource_id TEXT NOT NULL,
            before_json TEXT,
            after_json TEXT,
            reason TEXT,
            simulated INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE UNIQUE INDEX IF NOT EXISTS ux_devices_farm_code ON devices(farm_id, code);
        CREATE INDEX IF NOT EXISTS ix_audit_events_resource ON audit_events(resource_type, resource_id, created_at);
        """
    )
    _ensure_columns(conn)
    conn.commit()
    count = conn.execute("SELECT COUNT(*) FROM farms").fetchone()[0]
    if count == 0:
        seed(conn)
    _sync_demo_contract(conn)


def seed(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        INSERT INTO farms(name, region, area_mu, crop_focus, status, edge_nodes, mqtt_online)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        ("新疆AI无人智慧农场", "新疆·克拉玛依试验田", 2000, "棉花 / 玉米 / 小麦", "沙箱模式", 3, 0),
    )
    farm_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    land_ids = []
    for row in LAND_SEED:
        code, name, area, soil, health, moisture, n, p, k, temp, pest, crop, variety, stage, yld, growth, pts = row
        ring = [pts[i : i + 2] for i in range(0, len(pts), 2)]
        if ring and ring[0] != ring[-1]:
            ring.append(ring[0])
        geo = {"type": "Polygon", "coordinates": [ring]}
        conn.execute(
            """
            INSERT INTO lands(farm_id, code, name, area_mu, soil_type, health_index, moisture, n, p, k, temp, pest_risk, growth, geojson)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (farm_id, code, name, area, soil, health, moisture, n, p, k, temp, pest, growth, json.dumps(geo, ensure_ascii=False)),
        )
        land_ids.append(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
        conn.execute(
            "INSERT INTO crops(land_id, name, variety, stage, planted_at, expected_yield) VALUES (?, ?, ?, ?, ?, ?)",
            (land_ids[-1], crop, variety, stage, "2026-04-01", yld),
        )

    tasks = [
        (farm_id, "北区滴灌阀组现场核验", "灌溉", "A-01", "Irrigation Agent", "待人工确认", "模拟 2026-09-12 08:00", "中"),
        (farm_id, "中区棉花调查航线登记", "巡检", "B-01", "Vision Agent", "待人工确认", "模拟 2026-09-12 10:30", "高"),
        (farm_id, "南区水肥证据补全", "水肥", "C-01", "Crop Expert Agent", "待审核", "待证据齐全", "中"),
        (farm_id, "无人农机深松条件复核", "农机", "C-02", "Robot Agent", "待审核", "待边界/道路/机手确认", "高"),
        (farm_id, "产量预测周报模拟", "分析", "全场", "Yield Agent", "已完成", "模拟 2026-09-11 18:00", "低"),
    ]
    conn.executemany(
        """
        INSERT INTO farm_tasks(farm_id, title, task_type, land_code, assignee, status, scheduled_at, priority)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        tasks,
    )

    for code, name, dtype, status, loc, value, mqtt, x, y, battery in DEVICE_SEED:
        conn.execute(
            """
            INSERT INTO devices(farm_id, code, name, device_type, status, location, last_value, mqtt, pos_x, pos_y, battery, vendor_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (farm_id, code, name, dtype, status, loc, f"模拟 · {value}", mqtt, x, y, battery, DEVICE_VENDOR_BY_CODE.get(code, "unassigned")),
        )

    agents = [
        ("Farm Master Agent", "农业生产总控", "规则分析", "已生成编排草稿，等待人工复核",
         ["回放队列", "不生成设备命令"], ["任务编排", "Agent通信", "KPI评估"], 0),
        ("Crop Expert Agent", "作物生长分析", "规则分析", "模拟指标仅触发补证，不形成生产结论",
         ["本地阈值待核实", "处方需人工批准"], ["长势评估", "候选处方"], 0),
        ("Irrigation Agent", "智能灌溉决策", "规则分析", "关键水量输入不完整，处方 NO_GO",
         ["节水 20% 为目标值", "田间持水量与 ETc 待补"], ["墒情计算", "候选处方"], 0),
        ("Vision Agent", "视觉识别", "规则分析", "关键词规则仿真，等待原始影像与验证集",
         ["样本量为界面模拟", "89.5% 为待验证目标"], ["病斑检测", "长势分割"], 0),
        ("Robot Agent", "无人设备调度", "安全锁定", "高风险动作缺证据，未生成设备命令",
         ["设备 ACK 未接入", "边界与人员隔离待核验"], ["路径草拟", "调度建议"], 0),
        ("Yield Agent", "产量预测", "规则分析", "仿真产量估算尚无本场测产校准",
         ["历史基线为模拟", "实收校准待导入"], ["产量模型", "偏差分析"], 0),
        ("Finance Agent", "收益分析", "规则分析", "增收为目标区间，缺基线与成本台账",
         ["节水减药目标", "成本与价格待导入"], ["成本测算", "ROI 草稿"], 0),
    ]
    for name, role, status, action, memory, tools, score in agents:
        conn.execute(
            "INSERT INTO agents(name, role, status, last_action, memory, tools, score) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (name, role, status, action, json.dumps(memory, ensure_ascii=False), json.dumps(tools, ensure_ascii=False), score),
        )

    assets = [
        ("地块边界与权属图层", "GIS", "模拟 · 2000亩 / 6 地块", "Land Service", "屏幕示意坐标 · 无 CRS/测绘来源", "农场版"),
        ("土壤含水率时序", "时序", "模拟 · 多深度", "Device Service", "候选灌溉研判数据", "企业版"),
        ("病虫害视觉样本库", "影像", "模拟索引 · 未接 MinIO", "Vision Service", "识别率目标 89.5% · 未验证", "模型市场"),
        ("农业知识图谱", "图谱", "仿真规模 · 4.8 万节点", "RAG Service", "原文与版本待绑定", "政府版"),
        ("产量预测模型 V3.2", "模型", "棉花/玉米/小麦", "Model Service", "试验基地校验中", "模型市场"),
        ("无人作业轨迹包", "轨迹", "流程回放 · 无设备 ACK", "Robot Service", "候选路线模拟", "Agent市场"),
        ("向量知识库", "向量", "仿真规模 · 86 万条", "RAG Service", "原文授权与版本待核验", "企业版"),
    ]
    conn.executemany(
        "INSERT INTO data_assets(name, asset_type, volume, owner, value_note, market) VALUES (?, ?, ?, ?, ?, ?)",
        assets,
    )

    conn.execute(
        """
        INSERT INTO irrigation_plans(land_code, water_mm, fertilizer, reason, status, calculation_status)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        ("B-01", None, "候选处方；实际肥料与剂量未计算", "缺田间持水量、根层、ETc、有效降雨、效率和传感器 QC", "NO_GO · 待补证据", "NOT_CALCULATED"),
    )

    missions = [
        ("UAV-001", "B-01/B-02 调查航线仿真", "待人工确认", 62, "待空域/天气/返航点核验"),
        ("TRACTOR-001", "C-02 深松候选路线", "NO_GO", 0, "待边界/道路/机手确认"),
        ("ROBOT-001", "A-01 局部补施候选处方", "NO_GO", 0, "待农艺与现场证据"),
    ]
    conn.executemany(
        "INSERT INTO robot_missions(device, mission, status, progress, eta) VALUES (?, ?, ?, ?, ?)",
        missions,
    )

    knowledge = [
        ("灌溉证据清单（仿真摘要）", "待绑定官方指南原文与版本", "须核验田间持水量、根层、ETc、有效降雨、灌溉效率、计量与传感器 QC；摘要不可替代属地处方。"),
        ("病虫调查证据清单（仿真摘要）", "待绑定属地植保规程", "先确认物种、虫态/病级、调查方法、样点与当地经济阈值；证据不足不得形成施药处方。"),
        ("节水目标核验（仿真摘要）", "待绑定基线、流量计与作业台账", "20% 节水和 400–600 元增收均为目标场景，不是实测结论。"),
        ("无人农机作业门禁（仿真摘要）", "待绑定设备手册与属地要求", "须核验作业边界、障碍、人员隔离、机具点检、机手/监护人、天气、定位通信与设备 ACK。"),
    ]
    conn.executemany("INSERT INTO knowledge(title, source, snippet) VALUES (?, ?, ?)", knowledge)

    models = [
        ("AgrLLM-Farm-7B", "LLM", "v2.4-demo", "仿真模型", "可用率目标 93% · 未验证"),
        ("PestVision-X", "Vision", "v3.1-demo", "仿真模型", "准确率目标 89.5% · 无本场验证集"),
        ("YieldPredict-V3", "Prediction", "v3.2-demo", "仿真模型", "RMSE 目标 18.6 kg/亩 · 未校准"),
        ("IrrigateOpt", "Simulation", "v1.8-demo", "仿真模型", "节水目标约 20% · 待基线核验"),
    ]
    conn.executemany(
        "INSERT INTO models(name, type, version, status, metric) VALUES (?, ?, ?, ?, ?)",
        models,
    )
    conn.execute("INSERT OR REPLACE INTO app_state(key, value) VALUES ('role', 'farm')")
    conn.commit()
