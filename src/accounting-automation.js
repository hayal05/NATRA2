import { invoke } from "@tauri-apps/api/core";

const money = n => `ETB ${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const EPS = 0.01;
let timer = null;
let running = false;
let lastHealth = null;

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function closeEnough(a, b) { return Math.abs(num(a) - num(b)) <= EPS; }
function escapeHtml(v) { return String(v ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c])); }

function addStyle() {
  if (document.getElementById("natraAccountingAutomationStyle")) return;
  const s = document.createElement("style");
  s.id = "natraAccountingAutomationStyle";
  s.textContent = `
    .accounting-health{margin-top:18px}
    .accounting-health-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
    .accounting-health-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:14px}
    .ah-stat{padding:12px;border:1px solid var(--border,#e5e7eb);border-radius:10px;background:var(--surface,#fff)}
    .ah-stat small{display:block;color:#64748b;font-size:11px}.ah-stat b{display:block;margin-top:3px;font-size:18px}
    .ah-ok{color:#16803c}.ah-warn{color:#a15c00}.ah-bad{color:#b42318}
    .ah-list{display:grid;gap:8px;margin-top:14px}.ah-row{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid var(--border,#e5e7eb);border-radius:10px}
    .ah-dot{width:9px;height:9px;border-radius:50%;margin-top:5px;flex:0 0 auto;background:#64748b}.ah-dot.ok{background:#16803c}.ah-dot.warn{background:#a15c00}.ah-dot.bad{background:#b42318}
    .ah-row b{display:block}.ah-row small{display:block;margin-top:2px;color:#64748b}
    .ah-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:14px;color:#64748b;font-size:11px}
    @media(max-width:900px){.accounting-health-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.accounting-health-head{align-items:flex-start;flex-direction:column}}
  `;
  document.head.appendChild(s);
}

function ensurePanel() {
  const page = document.getElementById("page-reports") || document.getElementById("page-dashboard");
  if (!page) return null;
  let panel = document.getElementById("natraAccountingHealth");
  if (panel) return panel;
  panel = document.createElement("div");
  panel.id = "natraAccountingHealth";
  panel.className = "card panel accounting-health";
  panel.innerHTML = `
    <div class="accounting-health-head">
      <div><h3 style="margin:0">Accounting Health & Automation</h3><small style="color:#64748b">Continuous reconciliation of sales, purchases, cash, inventory and reporting totals.</small></div>
      <button class="btn" id="runAccountingHealth">Run Check</button>
    </div>
    <div class="accounting-health-grid" id="accountingHealthStats"></div>
    <div class="ah-list" id="accountingHealthList"><div class="ah-row"><span class="ah-dot"></span><div><b>Checking…</b><small>The reconciliation engine is starting.</small></div></div></div>
    <div class="ah-footer"><span id="accountingHealthTime">Not checked yet</span><span>Automatic check: every 15 seconds + after data changes</span></div>`;
  const content = page.querySelector(".content-inner") || page;
  content.appendChild(panel);
  panel.querySelector("#runAccountingHealth")?.addEventListener("click", () => runHealth(true));
  return panel;
}

async function loadData() {
  const [summary, report, products, movements, transactions, sales, purchases] = await Promise.all([
    invoke("dashboard_summary"),
    invoke("report_summary"),
    invoke("list_products"),
    invoke("list_stock_movements"),
    invoke("list_transactions"),
    invoke("list_sales_history"),
    invoke("list_purchase_history")
  ]);
  return { summary: summary || {}, report: report || {}, products: products || [], movements: movements || [], transactions: transactions || [], sales: sales || [], purchases: purchases || [] };
}

function reconcile(data) {
  const { summary, report, products, movements, transactions, sales, purchases } = data;
  const checks = [];

  const saleRevenue = sales.reduce((t, x) => t + num(x.revenue), 0);
  const saleCogs = sales.reduce((t, x) => t + num(x.cogs), 0);
  const saleProfit = sales.reduce((t, x) => t + num(x.profit), 0);
  const saleCash = transactions.filter(x => x.tx_type === "SALE").reduce((t, x) => t + num(x.amount), 0);
  const purchaseTotal = purchases.reduce((t, x) => t + num(x.total), 0);
  const purchaseCash = transactions.filter(x => x.tx_type === "PURCHASE").reduce((t, x) => t + num(x.amount), 0);

  checks.push({
    key: "sales-revenue", level: closeEnough(saleRevenue, report.revenue) ? "ok" : "bad",
    title: "Sales ↔ revenue", detail: `${money(saleRevenue)} sales history vs ${money(report.revenue)} report revenue.`
  });
  checks.push({
    key: "sales-profit", level: closeEnough(saleProfit, report.profit) ? "ok" : "bad",
    title: "Sales ↔ gross profit", detail: `${money(saleProfit)} transaction profit vs ${money(report.profit)} report profit.`
  });
  checks.push({
    key: "sales-cash", level: closeEnough(saleRevenue, saleCash) ? "ok" : "warn",
    title: "Sales ↔ cash receipts", detail: `${money(saleCash)} cash receipts against ${money(saleRevenue)} recorded sales. Credit sales require the future receivables workflow.`
  });
  checks.push({
    key: "purchases-cash", level: closeEnough(purchaseTotal, purchaseCash) ? "ok" : "warn",
    title: "Purchases ↔ cash payments", detail: `${money(purchaseCash)} purchase cash payments against ${money(purchaseTotal)} received purchases.`
  });

  const negative = products.filter(p => num(p.stock) < -EPS);
  checks.push({
    key: "negative-stock", level: negative.length ? "bad" : "ok",
    title: "Negative inventory", detail: negative.length ? `${negative.length} product(s) have negative stock.` : "No negative stock quantities detected."
  });

  const latestMovement = new Map();
  for (const m of movements) {
    const sku = String(m.sku || "");
    const existing = latestMovement.get(sku);
    if (!existing || String(m.created_at || "") > String(existing.created_at || "")) latestMovement.set(sku, m);
  }
  const stockDrift = products.filter(p => {
    const m = latestMovement.get(String(p.sku || ""));
    return m && !closeEnough(p.stock, m.balance_after);
  });
  checks.push({
    key: "stock-ledger", level: stockDrift.length ? "bad" : "ok",
    title: "Inventory ↔ movement ledger", detail: stockDrift.length ? `${stockDrift.length} product(s) differ from their latest movement balance.` : "Current stock agrees with the latest recorded movement balance where movement history is available."
  });

  const duplicateRefs = transactions.map(x => x.reference).filter((r, i, a) => r && a.indexOf(r) !== i);
  checks.push({
    key: "unique-cash-ref", level: duplicateRefs.length ? "bad" : "ok",
    title: "Transaction reference uniqueness", detail: duplicateRefs.length ? `${new Set(duplicateRefs).size} duplicate reference(s) detected.` : "No duplicate cash transaction references detected in the loaded ledger window."
  });

  const configuredRate = Number((JSON.parse(localStorage.getItem("natraSettings") || "{}") || {}).taxRate || 0);
  const estimateRate = Number(localStorage.getItem("natra.estimatedTaxRate") || 0);
  checks.push({
    key: "tax-rate-source", level: closeEnough(configuredRate, estimateRate) ? "ok" : "warn",
    title: "Tax configuration consistency", detail: `Settings rate ${configuredRate}% vs estimated-tax module rate ${estimateRate}%. A single authoritative tax configuration is required for production tax automation.`
  });

  const cashIn = transactions.filter(x => ["SALE","INCOME","PAYMENT","TRANSFER_IN"].includes(x.tx_type)).reduce((t, x) => t + num(x.amount), 0);
  const cashOut = transactions.filter(x => ["EXPENSE","PURCHASE","REFUND","TRANSFER_OUT"].includes(x.tx_type)).reduce((t, x) => t + num(x.amount), 0);
  const externalIn = transactions.filter(x => ["SALE","INCOME","PAYMENT"].includes(x.tx_type)).reduce((t, x) => t + num(x.amount), 0);
  const externalOut = transactions.filter(x => ["EXPENSE","PURCHASE","REFUND"].includes(x.tx_type)).reduce((t, x) => t + num(x.amount), 0);
  const transferNet = transactions.filter(x => ["TRANSFER_IN","TRANSFER_OUT"].includes(x.tx_type)).reduce((t, x) => t + (x.tx_type === "TRANSFER_IN" ? num(x.amount) : -num(x.amount)), 0);
  checks.push({
    key: "cash-flow", level: closeEnough(transferNet, 0) ? "ok" : "warn",
    title: "Cash-flow transfer neutrality", detail: `Internal transfers net ${money(transferNet)}. Transfers must not inflate operating cash flow.`
  });

  const calculatedStockValue = products.reduce((t, p) => t + num(p.stock) * num(p.cost), 0);
  checks.push({
    key: "inventory-value", level: closeEnough(calculatedStockValue, report.inventory_value) ? "ok" : "bad",
    title: "Inventory value", detail: `${money(calculatedStockValue)} calculated from product stock × cost vs ${money(report.inventory_value)} report value.`
  });

  const badCount = checks.filter(c => c.level === "bad").length;
  const warnCount = checks.filter(c => c.level === "warn").length;
  const status = badCount ? "bad" : warnCount ? "warn" : "ok";
  return { checks, status, badCount, warnCount, sales: saleRevenue, purchases: purchaseTotal, cashIn: externalIn, cashOut: externalOut, stockValue: calculatedStockValue, cashBalance: num(summary.cash_balance), receivables: num(summary.receivables) };
}

function renderHealth(health) {
  const panel = ensurePanel();
  if (!panel) return;
  const stats = panel.querySelector("#accountingHealthStats");
  const list = panel.querySelector("#accountingHealthList");
  const time = panel.querySelector("#accountingHealthTime");
  const statusLabel = health.status === "ok" ? "Healthy" : health.status === "warn" ? "Review" : "Action required";
  const statusClass = health.status === "ok" ? "ah-ok" : health.status === "warn" ? "ah-warn" : "ah-bad";
  stats.innerHTML = `
    <div class="ah-stat"><small>Control status</small><b class="${statusClass}">${statusLabel}</b></div>
    <div class="ah-stat"><small>Exceptions</small><b class="${health.status === "ok" ? "ah-ok" : "ah-bad"}">${health.badCount + health.warnCount}</b></div>
    <div class="ah-stat"><small>Inventory value</small><b>${money(health.stockValue)}</b></div>
    <div class="ah-stat"><small>Receivables</small><b>${money(health.receivables)}</b></div>`;
  list.innerHTML = health.checks.map(c => `<div class="ah-row"><span class="ah-dot ${c.level}"></span><div><b>${escapeHtml(c.title)}</b><small>${escapeHtml(c.detail)}</small></div></div>`).join("");
  time.textContent = `Last checked ${new Date().toLocaleTimeString()}`;

  const dot = document.querySelector(".notify-dot");
  if (dot) dot.textContent = String(health.badCount + health.warnCount);
  window.natraAccountingHealth = health;
  window.dispatchEvent(new CustomEvent("natra-accounting-health", { detail: health }));
}

async function runHealth(showErrors = false) {
  if (running) return lastHealth;
  running = true;
  try {
    const data = await loadData();
    lastHealth = reconcile(data);
    renderHealth(lastHealth);
    return lastHealth;
  } catch (e) {
    if (showErrors) {
      const panel = ensurePanel();
      const list = panel?.querySelector("#accountingHealthList");
      if (list) list.innerHTML = `<div class="ah-row"><span class="ah-dot bad"></span><div><b>Reconciliation unavailable</b><small>${escapeHtml(String(e))}</small></div></div>`;
    }
    return null;
  } finally {
    running = false;
  }
}

function boot() {
  addStyle();
  ensurePanel();
  runHealth(false);
  clearInterval(timer);
  timer = setInterval(() => runHealth(false), 15000);
  window.addEventListener("focus", () => runHealth(false));
  window.addEventListener("natra-data-changed", () => setTimeout(() => runHealth(false), 150));
  window.addEventListener("natra-settings-changed", () => setTimeout(() => runHealth(false), 150));
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 700), { once: true });
else setTimeout(boot, 700);
