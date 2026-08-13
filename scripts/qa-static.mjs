import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const jsFiles = [
  "src/main.js","src/cloud.js","src/production.js","src/security.js",
  "src/reports.js","src/receipt.js","server/src/server.js","server/src/auth.js","server/src/db.js"
];

let failed = false;
for (const rel of jsFiles) {
  const file = path.join(root, rel);
  const result = spawnSync(process.execPath, ["--check", file], {encoding:"utf8"});
  if (result.status !== 0) {
    failed = true;
    console.error(`FAIL JS syntax: ${rel}\n${result.stderr}`);
  } else {
    console.log(`PASS JS syntax: ${rel}`);
  }
}

for (const rel of ["package.json","server/package.json","src-tauri/tauri.conf.json"]) {
  try { JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); console.log(`PASS JSON: ${rel}`); }
  catch (e) { failed = true; console.error(`FAIL JSON: ${rel}: ${e.message}`); }
}

const rust = fs.readFileSync(path.join(root,"src-tauri/src/lib.rs"),"utf8");
for (const required of [
  "configure_cloud_sync","get_cloud_sync_config","backup_database","restore_database",
  "record_sale","record_purchase","record_return","record_customer_payment"
]) {
  if (!rust.includes(`async fn ${required}`)) { failed = true; console.error(`FAIL Rust command missing: ${required}`); }
}
if (rust.includes("Samsung Monitor 24") || rust.includes("420000,465000,510000")) {
  failed = true;
  console.error("FAIL demo data detected in production source");
} else {
  console.log("PASS no demo KPI/product data");
}

if (failed) process.exit(1);
console.log("Static QA passed. A Windows Rust/Tauri build is still required.");
