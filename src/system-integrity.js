import { invoke } from "@tauri-apps/api/core";
import Chart from "chart.js/auto";

const IN = new Set(["SALE", "INCOME", "PAYMENT", "TRANSFER_IN"]);
const OUT = new Set(["PURCHASE", "EXPENSE", "REFUND", "TRANSFER_OUT"]);
const money = n => `ETB ${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const readSettings = () => {
  try { return JSON.parse(localStorage.getItem("natraSettings") || "{}"); } catch (_) { return {}; }
};

function cashTotals(rows) {
  let cashIn = 0, cashOut = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const amount = Number(row.amount || 0);
    if (IN.has(String(row.tx_type))) cashIn += amount;
    if (OUT.has(String(row.tx_type))) cashOut += amount;
  }
  return { cashIn, cashOut, balance: cashIn - cashOut };
}

async function refreshDashboardCash() {
  const root = document.querySelector("#page-dashboard");
  if (!root) return;
  try {
    const rows = await invoke("list_transactions");
    const totals = cashTotals(rows);
    const kpis = root.querySelectorAll(".kpi-value");
    if (kpis[3]) kpis[3].textContent = money(totals.balance);
  } catch (_) {}
}

function enforceStockAsAdjustmentControlled() {
  const sku = document.querySelector("#fSku");
  const stock = document.querySelector("#fStock");
  if (!sku || !stock || !sku.disabled) return;
  if (stock.dataset.integrityLocked === "1") return;
  stock.dataset.integrityLocked = "1";
  stock.disabled = true;
  stock.title = "Existing stock is controlled by Sales, Purchases, Returns and Stock Adjustments.";
  const label = stock.closest(".form-field")?.querySelector("label");
  if (label) label.textContent = "Current stock (automatic)";
}

function enhancePurchaseProductSelection() {
  const select = document.querySelector("#purchaseSku");
  if (!select || select.dataset.integrityEnhanced === "1") return;
  select.dataset.integrityEnhanced = "1";
  const update = () => {
    const products = window.__natraProducts || [];
    const product = products.find(p => p.sku === select.value);
    const category = document.querySelector("#purchaseProductCategory");
    if (category) category.value = product?.category || "";
  };
  select.addEventListener("change", update);
  update();
}

let cashChart;
async function refreshCashFlowAccounting() {
  const page = document.querySelector("#page-cashflow.active");
  if (!page) return;
  try {
    const rows = await invoke("list_transactions");
    const totals = cashTotals(rows);
    const stats = page.querySelector("#cfStats");
    if (stats) stats.innerHTML = `
      <div class="stat-card"><span>Cash balance</span><strong>${money(totals.balance)}</strong></div>
      <div class="stat-card"><span>Cash In</span><strong>${money(totals.cashIn)}</strong></div>
      <div class="stat-card"><span>Cash Out</span><strong>${money(totals.cashOut)}</strong></div>
      <div class="stat-card"><span>Net Cash Flow</span><strong>${money(totals.balance)}</strong></div>`;

    const byDay = {};
    for (const row of rows || []) {
      const day = String(row.created_at || "").slice(0, 10);
      if (!day) continue;
      byDay[day] ??= { in: 0, out: 0 };
      if (IN.has(String(row.tx_type))) byDay[day].in += Number(row.amount || 0);
      if (OUT.has(String(row.tx_type))) byDay[day].out += Number(row.amount || 0);
    }
    const keys = Object.keys(byDay).sort().slice(-14);
    const labels = keys.length ? keys.map(d => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })) : ["No activity"];
    let running = 0;
    const net = keys.map(k => { running += byDay[k].in - byDay[k].out; return running; });
    cashChart?.destroy();
    const canvas = page.querySelector("#cfAccountingChart");
    if (canvas) {
      cashChart = new Chart(canvas, {
        type: "line",
        data: { labels, datasets: [
          { label: "Cash In", data: keys.map(k => byDay[k].in), tension: .3, borderWidth: 2 },
          { label: "Cash Out", data: keys.map(k => byDay[k].out), tension: .3, borderWidth: 2 },
          { label: "Net Movement", data: net, tension: .3, borderWidth: 2 }
        ] },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom" } }, scales: { y: { beginAtZero: true } } }
      });
    }
    const source = page.querySelector("#cfSources");
    if (source) {
      const byType = type => (rows || []).filter(r => String(r.tx_type) === type).reduce((s, r) => s + Number(r.amount || 0), 0);
      source.innerHTML = `
        <div class="cf-source"><span>Sales receipts</span><b>${money(byType("SALE"))}</b></div>
        <div class="cf-source"><span>Customer payments</span><b>${money(byType("PAYMENT"))}</b></div>
        <div class="cf-source"><span>Other income</span><b>${money(byType("INCOME"))}</b></div>
        <div class="cf-source"><span>Supplier purchases</span><b>${money(byType("PURCHASE"))}</b></div>
        <div class="cf-source"><span>Operating expenses</span><b>${money(byType("EXPENSE"))}</b></div>
        <div class="cf-source"><span>Refunds</span><b>${money(byType("REFUND"))}</b></div>
        <div class="cf-source"><span>Internal transfers</span><small>Excluded from net business cash flow because they move money between business accounts.</small></div>`;
    }
  } catch (_) {}
}

async function refreshEstimatedTax() {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar) return;
  let card = sidebar.querySelector(".natra-estimated-tax");
  if (!card) {
    card = document.createElement("div");
    card.className = "natra-estimated-tax";
    card.innerHTML = `<div class="natra-estimated-tax-head"><b>Estimated Tax</b><span>Auto</span></div><div class="natra-estimated-tax-value" id="systemEstimatedTaxValue">ETB 0</div><div class="natra-estimated-tax-meta"><span>Profit basis</span><b id="systemTaxProfit">ETB 0</b></div><div class="natra-estimated-tax-meta"><span>Rate</span><input id="systemTaxRate" type="number" min="0" max="100" step="0.01" aria-label="Estimated tax rate">%</div>`;
    sidebar.appendChild(card);
    const rate = card.querySelector("#systemTaxRate");
    rate.value = Number(readSettings().taxRate ?? localStorage.getItem("natra.estimatedTaxRate") ?? 0);
    rate.addEventListener("change", () => {
      const settings = readSettings();
      settings.taxRate = Math.min(100, Math.max(0, Number(rate.value) || 0));
      localStorage.setItem("natraSettings", JSON.stringify(settings));
      localStorage.setItem("natra.estimatedTaxRate", String(settings.taxRate));
      refreshEstimatedTax();
    });
  }
  try {
    const summary = await invoke("report_summary");
    const profit = Math.max(0, Number(summary?.profit || 0));
    const rate = Math.min(100, Math.max(0, Number(card.querySelector("#systemTaxRate")?.value || 0)));
    card.querySelector("#systemTaxProfit").textContent = money(profit);
    card.querySelector("#systemEstimatedTaxValue").textContent = money(profit * rate / 100);
  } catch (_) {}
}

function styles() {
  if (document.getElementById("natraIntegrityStyles")) return;
  const s = document.createElement("style");
  s.id = "natraIntegrityStyles";
  s.textContent = `.natra-estimated-tax{margin:10px 12px 4px;padding:10px 11px;border:1px solid rgba(148,163,184,.18);border-radius:11px;background:rgba(15,23,42,.28);color:#fff}.natra-estimated-tax-head{display:flex;justify-content:space-between;font-size:11px}.natra-estimated-tax-head span{font-size:9px;opacity:.65}.natra-estimated-tax-value{margin-top:5px;font-size:18px;font-weight:800}.natra-estimated-tax-meta{display:flex;justify-content:space-between;gap:6px;margin-top:4px;font-size:9px;color:#94a3b8}.natra-estimated-tax-meta b{color:#dbeafe}.natra-estimated-tax-meta input{width:42px;background:transparent;border:0;border-bottom:1px solid rgba(148,163,184,.35);color:#fff;text-align:right;font-size:9px;outline:none}.form-field input:disabled{opacity:.7;cursor:not-allowed}`;
  document.head.appendChild(s);
}

function boot() {
  styles();
  const observer = new MutationObserver(() => {
    enforceStockAsAdjustmentControlled();
    enhancePurchaseProductSelection();
    refreshEstimatedTax();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "disabled"] });
  setInterval(() => {
    refreshDashboardCash();
    refreshCashFlowAccounting();
    refreshEstimatedTax();
  }, 5000);
  refreshDashboardCash();
  refreshEstimatedTax();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
