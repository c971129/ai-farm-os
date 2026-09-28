/* 界面英文/术语走查（仅工具脚本，不属于产品代码） */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const files = [
  "assets/app.js",
  "assets/engine.js",
  "assets/wall.js",
  "assets/spec.js",
  "assets/mxsj-agents.js",
  "assets/equipment-catalog.js",
  "index.html",
];
const terms = ["NO_GO", "ACK", "ETc", "IPM", "CRS", "SLA", "ETA", "QC", "RAG", "ROI", "KPI", "OCR", "Agent", "Farm Master", "Crop Expert"];
for (const t of terms) {
  const re = new RegExp("\\b" + t.replace(/ /g, "\\s") + "\\b", "g");
  const hits = [];
  for (const f of files) {
    const n = (fs.readFileSync(path.join(ROOT, f), "utf8").match(re) || []).length;
    if (n) hits.push(`${path.basename(f)}:${n}`);
  }
  if (hits.length) console.log(t.padEnd(14), hits.join("  "));
}
