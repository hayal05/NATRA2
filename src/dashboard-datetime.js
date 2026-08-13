import { invoke } from "@tauri-apps/api/core";

const dtState = {
  start: null,
  end: null,
  sales: [],
  transactions: [],
  dashboard: null,
  reports: null,
};

const pad = (n) => String(n).padStart(2, "0");
const localDateTimeValue = (date) => `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
const moneyDT = (n) => `ETB ${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const parseDate = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; };
const escDT = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));

function formatRange(start, end) {
  if (!start || !end) return "All dates";
  const opts = { year: "numeric", month: "short", day: "numeric" };
  const a = start.toLocaleDateString(undefined, opts);
  const b = end.toLocaleDateString(undefined, opts);
  const same = start.toDateString() === end.toDateString();
  if (same) return a;
  return `${a} – ${b}`;
}

function quickRange(name) {
  const now = new Date();
  if (name === "today") return [startOfDay(now), endOfDay(now)];
  if (name === "yesterday") { const d = new Date(now); d.setDate(d.getDate()-1); return [startOfDay(d), endOfDay(d)]; }
  if (name === "week") {
    const d = startOfDay(now); const day = d.getDay(); const mondayOffset = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate()-mondayOffset); const end = endOfDay(new Date(d)); end.setDate(d.getDate()+6); return [d, end];
  }
  if (name === "month") return [new Date(now.getFullYear(), now.getMonth(), 1, 0,0,0,0), new Date(now.getFullYear(), now.getMonth()+1, 0, 23,59,59,999)];
  if (name === "last-month") return [new Date(now.getFullYear(), now.getMonth()-1, 1, 0,0,0,0), new Date(now.getFullYear(), now.getMonth(), 0, 23,59,59,999)];
  return [null, null];
}

function filteredRows(rows, start, end, field) {
  if (!start || !end) return rows;
  return rows.filter(row => {
    const d = parseDate(row[field]);
    return d && d >= start && d <= end;
  });
}

function calculateSales(rows) {
  return rows.reduce((a, r) => {
    a.revenue += Number(r.revenue || 0);
    a.cogs += Number(r.cogs || 0);
    a.profit += Number(r.profit || 0);
    return a;
  }, { revenue: 0, cogs: 0, profit: 0 });
}

function calculateCash(rows) {
  const cashInTypes = ["SALE", "INCOME", "PAYMENT"];
  const cashOutTypes = ["PURCHASE", "EXPENSE", "REFUND"];
  return rows.reduce((a, r) => {
    const type = String(r.tx_type || "");
    const amount = Number(r.amount || 0);
    if (cashInTypes.includes(type) && r.account !== "Credit") a.in += amount;
    if (cashOutTypes.includes(type)) a.out += amount;
    return a;
  }, { in: 0, out: 0 });
}

async function loadRangeData() {
  try {
    if (!dtState.sales.length) dtState.sales = await invoke("list_sales_history");
    if (!dtState.transactions.length) dtState.transactions = await invoke("list_transactions");
    const sales = filteredRows(dtState.sales, dtState.start, dtState.end, "date");
    const transactions = filteredRows(dtState.transactions, dtState.start, dtState.end, "created_at");
    const totals = calculateSales(sales);
    const cash = calculateCash(transactions);
    updateDashboardRange(totals, cash, sales);
    updateReportRange(totals, cash);
  } catch (e) {
    console.error("Dashboard date range error", e);
  }
}

function updateDashboardRange(totals, cash, sales) {
  const page = document.querySelector("#page-dashboard");
  if (!page) return;
  const values = page.querySelectorAll(".kpi-value");
  if (values[1]) values[1].textContent = moneyDT(totals.revenue);
  if (values[2]) values[2].textContent = moneyDT(totals.profit);
  if (values[3]) values[3].textContent = moneyDT(cash.in - cash.out);
  const meta = page.querySelectorAll(".kpi-meta");
  if (meta[1]) meta[1].textContent = `↕ ${formatRange(dtState.start, dtState.end)}`;
  if (meta[2]) meta[2].textContent = `↕ ${formatRange(dtState.start, dtState.end)}`;
  if (meta[3]) meta[3].textContent = `↕ ${formatRange(dtState.start, dtState.end)}`;
  const label = document.querySelector("#dashboardDateRange");
  if (label) label.textContent = formatRange(dtState.start, dtState.end);
  renderRangeChart(sales);
}

function renderRangeChart(sales) {
  const canvas = document.querySelector("#salesChart");
  if (!canvas || typeof Chart === "undefined") return;
  const buckets = {};
  sales.forEach(r => {
    const d = parseDate(r.date); if (!d) return;
    const key = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    if (!buckets[key]) buckets[key] = { sales: 0, profit: 0 };
    buckets[key].sales += Number(r.revenue || 0);
    buckets[key].profit += Number(r.profit || 0);
  });
  const keys = Object.keys(buckets).sort();
  const labels = keys.map(k => { const d = new Date(`${k}T00:00:00`); return d.toLocaleDateString(undefined,{month:"short",day:"numeric"}); });
  const chart = canvas.__natraDateChart;
  chart?.destroy();
  canvas.__natraDateChart = new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: [
      { label: "Sales", data: keys.map(k => buckets[k].sales), borderRadius: 5 },
      { label: "Gross Profit", data: keys.map(k => buckets[k].profit), borderRadius: 5 }
    ]},
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: "#eef1f6" } } } }
  });
}

function updateReportRange(totals, cash) {
  const page = document.querySelector("#page-reports");
  if (!page) return;
  const stats = page.querySelectorAll("#reportStats .stat b");
  if (stats[0]) stats[0].textContent = moneyDT(totals.revenue);
  if (stats[1]) stats[1].textContent = moneyDT(totals.cogs);
  if (stats[2]) stats[2].textContent = moneyDT(totals.profit);
  if (stats[3]) stats[3].textContent = `${totals.revenue > 0 ? (totals.profit / totals.revenue * 100).toFixed(1) : "0.0"}%`;
  const cashIn = document.querySelector("#repCashIn");
  const cashOut = document.querySelector("#repCashOut");
  if (cashIn) cashIn.textContent = moneyDT(cash.in);
  if (cashOut) cashOut.textContent = moneyDT(cash.out);
  const label = document.querySelector("#reportDateRange");
  if (label) label.textContent = formatRange(dtState.start, dtState.end);
}

function installDatePicker() {
  if (document.querySelector("#natraDatePicker")) return;
  const modal = document.createElement("div");
  modal.id = "natraDatePicker";
  modal.innerHTML = `
    <div class="natra-date-backdrop" data-close-date-picker></div>
    <div class="natra-date-modal card" role="dialog" aria-modal="true" aria-labelledby="natraDateTitle">
      <div class="panel-title"><span id="natraDateTitle">Select date & time range</span><button class="icon-btn" data-close-date-picker>×</button></div>
      <div class="natra-quick-grid">
        <button data-quick-range="today">Today</button><button data-quick-range="yesterday">Yesterday</button><button data-quick-range="week">This Week</button><button data-quick-range="month">This Month</button><button data-quick-range="last-month">Last Month</button><button data-quick-range="all">All Time</button>
      </div>
      <div class="form-grid">
        <div class="form-field"><label>Start date & time</label><input id="natraStartDate" type="datetime-local"></div>
        <div class="form-field"><label>End date & time</label><input id="natraEndDate" type="datetime-local"></div>
      </div>
      <div class="natra-date-actions"><button class="btn" data-close-date-picker>Cancel</button><button class="btn primary" id="applyNatraDate">Apply Range</button></div>
    </div>`;
  document.body.appendChild(modal);

  modal.addEventListener("click", e => {
    const quick = e.target.closest("[data-quick-range]");
    if (quick) {
      const [start, end] = quickRange(quick.dataset.quickRange);
      document.querySelector("#natraStartDate").value = start ? localDateTimeValue(start) : "";
      document.querySelector("#natraEndDate").value = end ? localDateTimeValue(end) : "";
      return;
    }
    if (e.target.closest("[data-close-date-picker]")) modal.classList.remove("open");
    if (e.target.closest("#applyNatraDate")) applyDateInputs();
  });
}

function openPicker() {
  installDatePicker();
  const modal = document.querySelector("#natraDatePicker");
  document.querySelector("#natraStartDate").value = dtState.start ? localDateTimeValue(dtState.start) : "";
  document.querySelector("#natraEndDate").value = dtState.end ? localDateTimeValue(dtState.end) : "";
  modal.classList.add("open");
}

function applyDateInputs() {
  const startValue = document.querySelector("#natraStartDate")?.value;
  const endValue = document.querySelector("#natraEndDate")?.value;
  const start = startValue ? parseDate(startValue) : null;
  const end = endValue ? parseDate(endValue) : null;
  if ((startValue && !start) || (endValue && !end)) return;
  if ((start && end && start > end)) { alert("Start date/time must be before the end date/time."); return; }
  dtState.start = start;
  dtState.end = end;
  document.querySelector("#natraDatePicker")?.classList.remove("open");
  refreshSelectedRange();
}

async function refreshSelectedRange() {
  await loadRangeData();
  updateRangeButtons();
}

function updateRangeButtons() {
  const label = formatRange(dtState.start, dtState.end);
  const dashboard = document.querySelector("#dashboardDateRange");
  const report = document.querySelector("#reportDateRange");
  if (dashboard) dashboard.textContent = label;
  if (report) report.textContent = label;
}

function addDashboardControls() {
  const dashboardHead = document.querySelector("#page-dashboard .page-head .actions");
  if (dashboardHead && !document.querySelector("#dashboardDatePickerBtn")) {
    dashboardHead.insertAdjacentHTML("afterbegin", `<button class="date-btn" id="dashboardDatePickerBtn">▣ <span id="dashboardDateRange">${escDT(formatRange(dtState.start,dtState.end))}</span>⌄</button>`);
    const old = dashboardHead.querySelector(":scope > .date-btn:not(#dashboardDatePickerBtn)");
    old?.remove();
    document.querySelector("#dashboardDatePickerBtn").addEventListener("click", openPicker);
  }
}

function addReportsControls() {
  const head = document.querySelector("#page-reports .page-head .actions");
  if (!head || document.querySelector("#reportDatePickerBtn")) return;
  const btn = document.createElement("button");
  btn.className = "date-btn";
  btn.id = "reportDatePickerBtn";
  btn.innerHTML = `▣ <span id="reportDateRange">${escDT(formatRange(dtState.start,dtState.end))}</span>⌄`;
  head.insertBefore(btn, head.firstChild);
  btn.addEventListener("click", openPicker);
}

function addClock() {
  if (document.querySelector("#natraClock")) return;
  const actions = document.querySelector(".top-actions");
  if (!actions) return;
  const clock = document.createElement("div");
  clock.id = "natraClock";
  clock.className = "natra-clock";
  clock.innerHTML = `<span id="natraClockDate"></span><b id="natraClockTime"></b>`;
  actions.insertBefore(clock, actions.firstChild);
  const tick = () => {
    const now = new Date();
    document.querySelector("#natraClockDate").textContent = now.toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric",year:"numeric"});
    document.querySelector("#natraClockTime").textContent = now.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit",second:"2-digit"});
  };
  tick();
  setInterval(tick, 1000);
}

function injectStyles() {
  if (document.querySelector("#natraDateTimeStyles")) return;
  const style = document.createElement("style");
  style.id = "natraDateTimeStyles";
  style.textContent = `
    .natra-clock{display:flex;flex-direction:column;align-items:flex-end;line-height:1.15;margin-right:8px;min-width:150px}
    .natra-clock span{font-size:11px;color:#667085}.natra-clock b{font-size:13px;color:#101828}
    #natraDatePicker{display:none;position:fixed;inset:0;z-index:9999}.natra-date-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.35)}
    #natraDatePicker.open{display:block}.natra-date-modal{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(620px,calc(100vw - 32px));padding:20px;z-index:2}
    .natra-quick-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0}.natra-quick-grid button{border:1px solid #e4e7ec;background:#fff;border-radius:8px;padding:9px;cursor:pointer}
    .natra-date-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.natra-date-modal input[type="datetime-local"]{width:100%;box-sizing:border-box}
    @media(max-width:800px){.natra-clock{display:none}.natra-quick-grid{grid-template-columns:repeat(2,1fr)}}
  `;
  document.head.appendChild(style);
}

async function initDateTimeReporting() {
  injectStyles();
  installDatePicker();
  addClock();
  addDashboardControls();
  addReportsControls();
  const [start, end] = quickRange("month");
  dtState.start = start;
  dtState.end = end;
  await refreshSelectedRange();
}

const observer = new MutationObserver(() => {
  addDashboardControls();
  addReportsControls();
});
observer.observe(document.body, { childList: true, subtree: true });

window.addEventListener("natra:refresh-reports", () => { dtState.sales = []; dtState.transactions = []; refreshSelectedRange(); });

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initDateTimeReporting, { once: true });
else initDateTimeReporting();
