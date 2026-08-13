
import { invoke } from "@tauri-apps/api/core";

export async function getDashboardSummary() {
  return invoke("dashboard_summary");
}

export function csvEscape(value) {
  const s = String(value ?? "");
  return `"${s.replaceAll('"','""')}"`;
}

export function toCSV(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.map(csvEscape).join(","),
    ...rows.map(r => headers.map(h => csvEscape(r[h])).join(","))
  ].join("\n");
}

export function downloadCSV(filename, rows) {
  const blob = new Blob([toCSV(rows)], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download=filename; a.click();
  URL.revokeObjectURL(url);
}
