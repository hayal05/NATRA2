import { invoke } from "@tauri-apps/api/core";

const money = (n) => `ETB ${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));

let refreshing = false;

function setDashboardSummary(data) {
  const values = [data.stock_value, data.today_sales, data.gross_profit, data.cash_balance, data.low_stock, data.receivables];
  document.querySelectorAll("#page-dashboard .kpi-value").forEach((el, i) => {
    el.textContent = i === 4 ? String(values[i] ?? 0) : money(values[i]);
  });
  const closing = document.querySelector("#closingBalance");
  if (closing) closing.textContent = money(data.cash_balance);
}

function setInventoryRows(products) {
  const bySku = new Map(products.map(p => [String(p.sku), p]));
  document.querySelectorAll("#inventoryBody tr").forEach(row => {
    const sku = row.querySelector("td:first-child")?.textContent?.trim();
    const p = bySku.get(sku);
    if (!p) return;
    const cells = row.children;
    if (cells[6]) cells[6].textContent = p.stock;
    if (cells[7]) cells[7].textContent = p.min_stock;
    if (cells[8]) cells[8].textContent = money(Number(p.stock) * Number(p.cost));
    if (cells[9]) {
      const low = Number(p.stock) <= Number(p.min_stock);
      const out = Number(p.stock) <= 0;
      cells[9].innerHTML = `<span class="badge ${out ? "red" : low ? "amber" : "green"}">${out ? "Out of stock" : low ? "Low stock" : "Active"}</span>`;
    }
  });

  const stats = document.querySelector("#inventoryStats");
  if (stats) {
    const value = products.reduce((sum, p) => sum + Number(p.stock || 0) * Number(p.cost || 0), 0);
    const low = products.filter(p => Number(p.stock) <= Number(p.min_stock)).length;
    const out = products.filter(p => Number(p.stock) <= 0).length;
    const vals = [products.length, money(value), low, out];
    stats.querySelectorAll(".stat b").forEach((el, i) => { if (vals[i] !== undefined) el.textContent = vals[i]; });
  }
}

function setLowStockPage(products) {
  const body = document.querySelector("#lowStockBody");
  if (!body) return;
  const rows = products.filter(p => Number(p.stock) <= Number(p.min_stock));
  body.innerHTML = rows.length ? rows.map(p => `
    <tr>
      <td><b>${esc(p.name)}</b></td><td>${esc(p.sku)}</td><td>${esc(p.category)}</td>
      <td>${p.stock}</td><td>${p.min_stock}</td><td>${Math.max(0, Number(p.min_stock) - Number(p.stock))}</td>
      <td><span class="badge ${Number(p.stock) <= 0 ? "red" : "amber"}">${Number(p.stock) <= 0 ? "Out of stock" : "Low stock"}</span></td>
      <td><button class="row-btn" data-page="purchases">Create Purchase</button></td>
    </tr>`).join("") : `<tr><td colspan="8" class="empty">No low stock items. Great.</td></tr>`;
}

function setCategoryValues(products) {
  const body = document.querySelector("#categoryBody");
  if (!body) return;
  const groups = {};
  products.forEach(p => {
    const name = p.category || "General";
    const g = groups[name] ||= { count: 0, value: 0, low: 0 };
    g.count += 1;
    g.value += Number(p.stock || 0) * Number(p.cost || 0);
    if (Number(p.stock) <= Number(p.min_stock)) g.low += 1;
  });
  body.innerHTML = Object.entries(groups).map(([name, g]) =>
    `<tr><td><b>${esc(name)}</b></td><td>${g.count}</td><td>${money(g.value)}</td><td>${g.low}</td><td><button class="row-btn">View Products</button></td></tr>`
  ).join("") || `<tr><td colspan="5" class="empty">No categories yet.</td></tr>`;
}

async function refreshInventoryViews() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [products, dashboard] = await Promise.all([
      invoke("list_products"),
      invoke("dashboard_summary")
    ]);
    setDashboardSummary(dashboard);
    setInventoryRows(products);
    setLowStockPage(products);
    setCategoryValues(products);
  } catch (_) {
    // main.js remains the primary renderer; this background refresh is best-effort.
  } finally {
    refreshing = false;
  }
}

refreshInventoryViews();
setInterval(refreshInventoryViews, 5000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshInventoryViews();
});
window.addEventListener("focus", refreshInventoryViews);
