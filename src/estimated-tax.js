import { invoke } from "@tauri-apps/api/core";

const STORAGE_KEY = "natra.estimatedTaxRate";
const money = (n) => `ETB ${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function getRate() {
  const saved = Number(localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(saved) && saved >= 0 && saved <= 100 ? saved : 0;
}

function setRate(rate) {
  const value = Math.min(100, Math.max(0, Number(rate) || 0));
  localStorage.setItem(STORAGE_KEY, String(value));
  return value;
}

async function refreshEstimatedTax() {
  try {
    const summary = await invoke("report_summary");
    const profit = Math.max(0, Number(summary?.profit || 0));
    const rate = getRate();
    const tax = profit * rate / 100;
    const taxEl = document.getElementById("estimatedTaxValue");
    const profitEl = document.getElementById("taxProfitValue");
    if (taxEl) taxEl.textContent = money(tax);
    if (profitEl) profitEl.textContent = money(profit);
  } catch (_) {
    // Keep the sidebar stable if the database is temporarily unavailable.
  }
}

function injectTaxStyles() {
  if (document.getElementById("estimatedTaxStyles")) return;
  const style = document.createElement("style");
  style.id = "estimatedTaxStyles";
  style.textContent = `
    .sidebar-tax{margin:12px 14px 10px;padding:12px;border:1px solid rgba(148,163,184,.18);border-radius:12px;background:rgba(15,23,42,.32)}
    .sidebar-tax-head{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:700;color:#cbd5e1}
    .tax-icon{width:22px;height:22px;display:grid;place-items:center;border-radius:7px;background:rgba(59,130,246,.16);color:#93c5fd;font-weight:800}
    .sidebar-tax-value{margin-top:6px;font-size:20px;font-weight:800;color:#f8fafc}
    .sidebar-tax-meta{display:flex;justify-content:space-between;margin-top:3px;font-size:10px;color:#94a3b8}
    .sidebar-tax-meta b{color:#cbd5e1}
    .sidebar-tax-controls{display:flex;align-items:center;justify-content:space-between;margin-top:9px;font-size:10px;color:#94a3b8}
    .tax-rate-wrap{display:flex;align-items:center;border:1px solid rgba(148,163,184,.25);border-radius:7px;background:rgba(15,23,42,.5);overflow:hidden}
    .tax-rate-wrap input{width:48px;border:0;outline:0;background:transparent;color:#f8fafc;text-align:right;padding:5px 2px 5px 5px;font-size:11px}
    .tax-rate-wrap span{padding-right:6px;color:#94a3b8}
    .sidebar-tax-note{display:block;margin-top:7px;line-height:1.35;color:#64748b;font-size:9px}
  `;
  document.head.appendChild(style);
}

async function boot() {
  injectTaxStyles();
  const rateEl = document.getElementById("taxRate");
  if (!rateEl) return;
  rateEl.value = getRate();
  rateEl.addEventListener("change", async () => {
    rateEl.value = setRate(rateEl.value);
    await refreshEstimatedTax();
  });
  rateEl.addEventListener("input", () => {
    const rate = Math.min(100, Math.max(0, Number(rateEl.value) || 0));
    const taxEl = document.getElementById("estimatedTaxValue");
    const profitEl = document.getElementById("taxProfitValue");
    invoke("report_summary").then(summary => {
      const profit = Math.max(0, Number(summary?.profit || 0));
      if (taxEl) taxEl.textContent = money(profit * rate / 100);
      if (profitEl) profitEl.textContent = money(profit);
    }).catch(() => {});
  });
  window.addEventListener("natra-data-changed", refreshEstimatedTax);
  await refreshEstimatedTax();
  setInterval(refreshEstimatedTax, 30000);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0), { once: true });
else setTimeout(boot, 0);
