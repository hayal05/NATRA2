import { invoke } from "@tauri-apps/api/core";

const money = (n) => `ETB ${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

const IN_TYPES = new Set(["SALE", "INCOME", "PAYMENT", "TRANSFER_IN"]);
const OUT_TYPES = new Set(["EXPENSE", "PURCHASE", "REFUND", "TRANSFER_OUT"]);

function startOfPeriod(period, now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === "today") return d;
  if (period === "week") {
    const day = d.getDay();
    const daysFromMonday = (day + 6) % 7;
    d.setDate(d.getDate() - daysFromMonday);
    return d;
  }
  if (period === "year") {
    d.setMonth(0, 1);
    return d;
  }
  d.setDate(1);
  return d;
}

function endOfPeriod(period, now = new Date()) {
  const d = startOfPeriod(period, now);
  if (period === "today") return new Date(d.getTime() + 86400000);
  if (period === "week") return new Date(d.getTime() + 7 * 86400000);
  if (period === "year") {
    d.setFullYear(d.getFullYear() + 1);
    return d;
  }
  d.setMonth(d.getMonth() + 1);
  return d;
}

function parseDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function renderCashFlow(rows, period) {
  const start = startOfPeriod(period);
  const end = endOfPeriod(period);
  const dated = (Array.isArray(rows) ? rows : [])
    .map(r => ({ ...r, _date: parseDate(r.created_at) }))
    .filter(r => r._date);

  const inPeriod = dated.filter(r => r._date >= start && r._date < end);
  const beforePeriod = dated.filter(r => r._date < start);
  const throughEnd = dated.filter(r => r._date < end);

  const cashIn = (list) => list.filter(r => IN_TYPES.has(String(r.tx_type))).reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const cashOut = (list) => list.filter(r => OUT_TYPES.has(String(r.tx_type))).reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const net = cashIn(inPeriod) - cashOut(inPeriod);
  const opening = cashIn(beforePeriod) - cashOut(beforePeriod);
  const closing = cashIn(throughEnd) - cashOut(throughEnd);

  const root = document.querySelector("#page-dashboard");
  if (!root) return;
  const summary = root.querySelector("#cashSummary");
  const closingEl = root.querySelector("#closingBalance");
  if (summary) {
    summary.innerHTML = `
      <div class="total-row"><span>Opening Balance</span><b>${money(opening)}</b></div>
      <div class="total-row"><span class="green-text">Cash In</span><b class="green-text">${money(cashIn(inPeriod))}</b></div>
      <div class="total-row"><span class="red-text">Cash Out</span><b class="red-text">${money(cashOut(inPeriod))}</b></div>
      <div class="total-row"><span class="blue-text">Net Cash Flow</span><b class="blue-text">${money(net)}</b></div>`;
  }
  if (closingEl) closingEl.textContent = money(closing);
}

async function refreshCashFlow(select) {
  const rows = await invoke("list_transactions");
  renderCashFlow(rows, select.value || "month");
}

function setup() {
  const root = document.querySelector("#page-dashboard");
  const select = root?.querySelector(".dashboard-bottom .card:nth-child(2) .compact-select");
  if (!select || select.dataset.intervalActivated === "1") return;

  select.dataset.intervalActivated = "1";
  select.innerHTML = `
    <option value="today">Today</option>
    <option value="week">This Week</option>
    <option value="month" selected>This Month</option>
    <option value="year">This Year</option>`;
  select.setAttribute("aria-label", "Cash flow reporting period");
  select.title = "Select cash flow reporting period";
  select.addEventListener("change", () => refreshCashFlow(select).catch(() => {}));
  refreshCashFlow(select).catch(() => {});
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setup, { once: true });
} else {
  setup();
}

window.addEventListener("natra-data-changed", () => {
  const select = document.querySelector("#page-dashboard .dashboard-bottom .card:nth-child(2) .compact-select");
  if (select?.dataset.intervalActivated === "1") refreshCashFlow(select).catch(() => {});
});
