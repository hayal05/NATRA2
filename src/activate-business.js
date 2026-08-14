import { invoke } from "@tauri-apps/api/core";
import { recordCustomerPayment, listSuppliers, getSyncStatus, printReceipt } from "./production.js";
import { getDashboardSummary, downloadCSV } from "./reports.js";
import { receiptHtml } from "./receipt.js";

const money = (n) => `ETB ${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const esc = (s) => String(s ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));

function toast(message) {
  const el = document.querySelector("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}

function page(id) { return document.querySelector(`#page-${id}`); }
function on(id, event, handler) {
  const el = document.getElementById(id);
  if (!el || el.dataset.activationBound === "1") return;
  el.dataset.activationBound = "1";
  el.addEventListener(event, () => Promise.resolve(handler()).catch(e => toast(e?.message || String(e))));
}
function addAction(id, text, handler) {
  const root = page(id);
  if (!root) return;
  const actions = root.querySelector(".page-head .actions");
  if (!actions || actions.querySelector(`[data-activation-action="${id}-${text}"]`)) return;
  const b = document.createElement("button");
  b.className = "btn";
  b.dataset.activationAction = `${id}-${text}`;
  b.textContent = text;
  b.addEventListener("click", () => Promise.resolve(handler()).catch(e => toast(e?.message || String(e))));
  actions.appendChild(b);
}
function panel(id, title, html = "") {
  const root = page(id);
  if (!root || root.querySelector(`[data-activation-panel="${id}"]`)) return null;
  const el = document.createElement("div");
  el.className = "card panel";
  el.dataset.activationPanel = id;
  el.innerHTML = `<div class="panel-title">${esc(title)}</div>${html}`;
  root.appendChild(el);
  return el;
}

async function loadProducts() {
  const products = await invoke("list_products");
  window.NATRA_PRODUCTION.products = Array.isArray(products) ? products : [];
  for (const id of ["adjustSku", "purchaseSku"]) {
    const select = document.getElementById(id);
    if (!select) continue;
    const current = select.value;
    select.innerHTML = window.NATRA_PRODUCTION.products.map(p => `<option value="${esc(p.sku)}">${esc(p.name)} (${esc(p.sku)})</option>`).join("");
    if (current && [...select.options].some(o => o.value === current)) select.value = current;
  }
  return window.NATRA_PRODUCTION.products;
}

async function activateReports() {
  addAction("reports", "Refresh Summary", async () => {
    const summary = await getDashboardSummary();
    window.NATRA_PRODUCTION.lastDashboardSummary = summary;
    toast("Dashboard summary refreshed.");
  });
  addAction("reports", "Export CSV", async () => {
    const root = page("reports");
    const table = root?.querySelector("table");
    if (!table) throw new Error("No report table is available to export yet.");
    const headers = [...table.querySelectorAll("thead th")].map(th => th.textContent.trim());
    const rows = [...table.querySelectorAll("tbody tr")].map(tr => {
      const cells = [...tr.querySelectorAll("td")].map(td => td.textContent.trim());
      return Object.fromEntries(headers.map((h, i) => [h || `Column ${i + 1}`, cells[i] ?? ""]));
    });
    if (!rows.length) throw new Error("There is no report data to export.");
    downloadCSV(`natra-report-${new Date().toISOString().slice(0,10)}.csv`, rows);
    toast("Report exported as CSV.");
  });
}

async function activateCustomers() {
  addAction("customers", "Record Payment", async () => {
    const customers = await invoke("list_customers");
    if (!Array.isArray(customers) || !customers.length) throw new Error("Create a customer before recording a payment.");
    const names = customers.map((c, i) => `${i + 1}. ${c.name || `Customer ${c.id}`}`).join("\n");
    const choice = Number(prompt(`Select customer number:\n\n${names}`));
    if (!Number.isInteger(choice) || choice < 1 || choice > customers.length) return;
    const customer = customers[choice - 1];
    const amount = Number(prompt(`Payment amount for ${customer.name}:`));
    if (!(amount > 0)) throw new Error("Enter a payment amount greater than zero.");
    const account = prompt("Account (Cash / Bank / Mobile Money):", "Cash") || "Cash";
    await recordCustomerPayment(customer.id, amount, account);
    toast(`Recorded ${money(amount)} payment for ${customer.name}.`);
    window.dispatchEvent(new CustomEvent("natra-data-changed", { detail: { type: "customer-payment", customerId: customer.id } }));
  });
}

async function activateSuppliers() {
  addAction("suppliers", "Refresh Suppliers", async () => {
    const suppliers = await listSuppliers();
    window.NATRA_PRODUCTION.suppliers = suppliers;
    toast(`${Array.isArray(suppliers) ? suppliers.length : 0} suppliers loaded.`);
    window.dispatchEvent(new CustomEvent("natra-suppliers-refreshed", { detail: suppliers }));
  });
}

async function activateCategories() {
  const render = async () => {
    const categories = await invoke("list_categories");
    const products = window.NATRA_PRODUCTION.products || await loadProducts();
    const body = document.querySelector("#categoryBody");
    if (!body) return;
    body.innerHTML = (Array.isArray(categories) ? categories : []).map(c => {
      const ps = products.filter(p => p.category === c.name);
      const value = ps.reduce((sum, p) => sum + Number(p.stock || 0) * Number(p.cost || 0), 0);
      const low = ps.filter(p => Number(p.stock || 0) <= Number(p.min_stock || 0)).length;
      return `<tr><td><b>${esc(c.name)}</b></td><td>${ps.length}</td><td>${money(value)}</td><td>${low}</td><td>${statusBadge(low ? "Low stock" : "Clear")}</td></tr>`;
    }).join("") || `<tr><td colspan="5" class="empty">No categories yet.</td></tr>`;
  };
  addAction("categories", "Refresh Categories", render);
  on("addCategoryBtn", "click", async () => {
    const name = prompt("Category name:");
    if (!name?.trim()) return;
    await invoke("create_category", { input: { name: name.trim() } });
    await render();
    toast("Category created.");
  });
  await render();
}

async function activateAdjustments() {
  await loadProducts();
  const render = async () => {
    const rows = await invoke("list_stock_movements");
    const body = document.querySelector("#adjustmentHistory");
    if (!body) return;
    const items = (Array.isArray(rows) ? rows : []).filter(r => String(r.movement_type || "").startsWith("ADJUSTMENT"));
    body.innerHTML = items.length ? `<div class="table-wrap"><table><thead><tr><th>Reference</th><th>SKU</th><th>Type</th><th>In</th><th>Out</th><th>Balance</th><th>Date</th></tr></thead><tbody>${items.map(r => `<tr><td>${esc(r.reference)}</td><td>${esc(r.sku)}</td><td>${esc(r.movement_type)}</td><td>${r.qty_in}</td><td>${r.qty_out}</td><td>${r.balance_after}</td><td>${esc(r.created_at)}</td></tr>`).join("")}</tbody></table></div>` : "<div class=\"empty\">No stock adjustments yet.</div>";
  };
  on("recordAdjustment", "click", async () => {
    const sku = document.getElementById("adjustSku")?.value;
    const qty = Number(document.getElementById("adjustQty")?.value);
    if (!sku || !(qty > 0)) throw new Error("Select a product and enter a positive quantity.");
    await invoke("record_stock_adjustment", { input: {
      sku,
      adjustment_type: document.getElementById("adjustType")?.value || "Increase",
      qty,
      reason: document.getElementById("adjustReason")?.value || "Stock count correction",
      notes: document.getElementById("adjustNotes")?.value || ""
    }});
    await loadProducts();
    await render();
    toast("Stock adjustment recorded.");
    window.dispatchEvent(new CustomEvent("natra-data-changed", { detail: { type: "stock-adjustment", sku } }));
  });
  addAction("adjustments", "Refresh History", render);
  await render();
}

async function activateMovement() {
  const render = async () => {
    const rows = await invoke("list_stock_movements");
    const root = document.querySelector("#movementTable");
    if (!root) return;
    const query = String(document.querySelector("#movementSearch")?.value || "").toLowerCase();
    const items = (Array.isArray(rows) ? rows : []).filter(r => !query || [r.reference,r.sku,r.movement_type].some(v => String(v || "").toLowerCase().includes(query)));
    root.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Reference</th><th>SKU</th><th>Movement</th><th>In</th><th>Out</th><th>Balance</th><th>Cost</th><th>Date</th></tr></thead><tbody>${items.map(r => `<tr><td>${esc(r.reference)}</td><td>${esc(r.sku)}</td><td>${statusBadge(r.movement_type)}</td><td>${r.qty_in}</td><td>${r.qty_out}</td><td>${r.balance_after}</td><td>${money(r.unit_cost)}</td><td>${esc(r.created_at)}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">No stock movements yet.</td></tr>`}</tbody></table></div>`;
  };
  addAction("movement", "Refresh", render);
  document.getElementById("movementSearch")?.addEventListener("input", () => render().catch(e => toast(e.message)));
  await render();
}

async function activateSalesHistory() {
  const render = async () => {
    const rows = await invoke("list_sales_history");
    const root = document.querySelector("#salesTable");
    if (!root) return;
    root.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Reference</th><th>Date</th><th>Revenue</th><th>COGS</th><th>Profit</th><th>Payment</th><th>Status</th></tr></thead><tbody>${(Array.isArray(rows) ? rows : []).map(r => `<tr><td>${esc(r.reference)}</td><td>${esc(r.date)}</td><td>${money(r.revenue)}</td><td>${money(r.cogs)}</td><td>${money(r.profit)}</td><td>${esc(r.payment_method)}</td><td>${statusBadge(r.status)}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">No sales recorded yet.</td></tr>`}</tbody></table></div>`;
  };
  addAction("sales", "Refresh Sales", render);
  await render();
}

async function activateReturns() {
  on("recordReturn", "click", async () => {
    const input = {
      sale_reference: document.getElementById("returnSale")?.value?.trim() || "",
      sku: document.getElementById("returnSku")?.value?.trim() || "",
      qty: Number(document.getElementById("returnQty")?.value),
      reason: document.getElementById("returnReason")?.value || "Customer return",
      account: document.getElementById("returnAccount")?.value || "Cash"
    };
    if (!input.sale_reference || !input.sku || !(input.qty > 0)) throw new Error("Sale reference, SKU and positive quantity are required.");
    const ref = await invoke("record_return", { input });
    toast(`Return recorded: ${ref}`);
    ["returnSale","returnSku","returnQty"].forEach(id => { const e=document.getElementById(id); if(e) e.value = id === "returnQty" ? "1" : ""; });
    await loadProducts();
    window.dispatchEvent(new CustomEvent("natra-data-changed", { detail: { type: "return", reference: ref } }));
  });
}

async function activatePurchases() {
  await loadProducts();
  const suppliers = await listSuppliers();
  const select = document.getElementById("purchaseSupplier");
  if (select && Array.isArray(suppliers)) select.innerHTML = `<option value="">Select supplier</option>${suppliers.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join("")}`;
  const updateTotal = () => {
    const q = Number(document.getElementById("purchaseQty")?.value || 0);
    const c = Number(document.getElementById("purchaseCost")?.value || 0);
    const total = document.getElementById("purchaseTotal");
    if (total) total.textContent = money(q * c);
  };
  ["purchaseQty","purchaseCost"].forEach(id => document.getElementById(id)?.addEventListener("input", updateTotal));
  on("recordPurchase", "click", async () => {
    const input = {
      supplier: document.getElementById("purchaseSupplier")?.value || "",
      sku: document.getElementById("purchaseSku")?.value || "",
      qty: Number(document.getElementById("purchaseQty")?.value),
      unit_cost: Number(document.getElementById("purchaseCost")?.value),
      account: document.getElementById("purchaseAccount")?.value || "Cash"
    };
    const ref = await invoke("record_purchase", { input });
    toast(`Purchase received: ${ref}`);
    await loadProducts();
    window.dispatchEvent(new CustomEvent("natra-data-changed", { detail: { type: "purchase", reference: ref } }));
  });
  updateTotal();
}

async function activatePurchaseHistory() {
  const render = async () => {
    const rows = await invoke("list_purchase_history");
    const root = document.querySelector("#purchase-historyTable");
    if (!root) return;
    root.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Reference</th><th>Supplier</th><th>Date</th><th>Total</th><th>Status</th></tr></thead><tbody>${(Array.isArray(rows) ? rows : []).map(r => `<tr><td>${esc(r.reference)}</td><td>${esc(r.supplier)}</td><td>${esc(r.date)}</td><td>${money(r.total)}</td><td>${statusBadge(r.status)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No purchases recorded yet.</td></tr>`}</tbody></table></div>`;
  };
  addAction("purchase-history", "Refresh Purchases", render);
  await render();
}

async function activateTransactions() {
  const render = async () => {
    const rows = await invoke("list_transactions");
    const body = document.querySelector("#transactionBody");
    if (!body) return;
    const query = String(document.querySelector("#transactionSearch")?.value || "").toLowerCase();
    const type = document.querySelector("#transactionTypeFilter")?.value || "All types";
    const items = (Array.isArray(rows) ? rows : []).filter(r => (!query || [r.reference,r.tx_type,r.description,r.account].some(v => String(v || "").toLowerCase().includes(query))) && (type === "All types" || r.tx_type === type));
    body.innerHTML = items.map(r => `<tr><td>${esc(r.reference)}</td><td>${statusBadge(r.tx_type)}</td><td>${esc(r.description)}</td><td>${money(r.amount)}</td><td>${esc(r.account)}</td><td>${esc(r.created_at)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No transactions yet.</td></tr>`;
  };
  addAction("transactions", "Refresh", render);
  document.getElementById("transactionSearch")?.addEventListener("input", () => render().catch(e => toast(e.message)));
  document.getElementById("transactionTypeFilter")?.addEventListener("change", () => render().catch(e => toast(e.message)));
  await render();
}

async function activateIncome() {
  on("recordIncome", "click", async () => {
    const input = {
      category: document.getElementById("incomeCategory")?.value || "Other Income",
      description: document.getElementById("incomeDescription")?.value?.trim() || "",
      amount: Number(document.getElementById("incomeAmount")?.value),
      account: document.getElementById("incomeAccount")?.value || "Cash"
    };
    const ref = await invoke("record_income", { input });
    toast(`Income recorded: ${ref}`);
    const e = document.getElementById("incomeDescription"); if (e) e.value = "";
    const a = document.getElementById("incomeAmount"); if (a) a.value = "";
  });
}

async function activateExpenses() {
  on("recordExpense", "click", async () => {
    const input = {
      category: document.getElementById("expenseCategory")?.value || "Operating",
      description: document.getElementById("expenseDescription")?.value?.trim() || "",
      amount: Number(document.getElementById("expenseAmount")?.value),
      account: document.getElementById("expenseAccount")?.value || "Cash"
    };
    const ref = await invoke("record_expense", { input });
    toast(`Expense recorded: ${ref}`);
    ["expenseDescription","expenseAmount"].forEach(id => { const e=document.getElementById(id); if(e) e.value=""; });
  });
}

async function activateTransfers() {
  on("recordTransfer", "click", async () => {
    const input = {
      from_account: document.getElementById("transferFrom")?.value || "Cash",
      to_account: document.getElementById("transferTo")?.value || "Bank",
      amount: Number(document.getElementById("transferAmount")?.value),
      note: document.getElementById("transferNote")?.value?.trim() || ""
    };
    const ref = await invoke("record_transfer", { input });
    toast(`Transfer recorded: ${ref}`);
    ["transferAmount","transferNote"].forEach(id => { const e=document.getElementById(id); if(e) e.value=""; });
  });
}

async function activateCashflow() {
  const root = panel("cashflow", "Cash Flow Engine", `<div id="activationCashflow" class="stat-strip"></div>`);
  const render = async () => {
    const summary = await invoke("report_summary");
    const el = document.getElementById("activationCashflow");
    if (!el) return;
    el.innerHTML = `<div class="card kpi"><div class="kpi-label">Revenue</div><div class="kpi-value">${money(summary.revenue)}</div></div><div class="card kpi"><div class="kpi-label">COGS</div><div class="kpi-value">${money(summary.cogs)}</div></div><div class="card kpi"><div class="kpi-label">Profit</div><div class="kpi-value">${money(summary.profit)}</div></div><div class="card kpi"><div class="kpi-label">Margin</div><div class="kpi-value">${Number(summary.margin || 0).toFixed(2)}%</div></div><div class="card kpi"><div class="kpi-label">Cash In</div><div class="kpi-value">${money(summary.cash_in)}</div></div><div class="card kpi"><div class="kpi-label">Cash Out</div><div class="kpi-value">${money(summary.cash_out)}</div></div>`;
    window.NATRA_PRODUCTION.lastReportSummary = summary;
  };
  addAction("cashflow", "Refresh Cash Flow", render);
  if (root) await render();
}

async function activateBackup() {
  const root = panel("backup", "Database Backup & Restore", `<div class="form-grid"><div class="form-field wide-field"><label>Backup / restore file path</label><input id="activationBackupPath" placeholder="Example: C:\\NATRA\\backup.sql"></div></div><div class="modal-actions"><button class="btn primary" id="activationBackup">Create Backup</button><button class="btn" id="activationRestore">Restore Backup</button></div><div class="info-box">Restore replaces data in the selected database. Create a fresh backup first.</div>`);
  if (!root) return;
  on("activationBackup", "click", async () => {
    const path = document.getElementById("activationBackupPath")?.value?.trim();
    if (!path) throw new Error("Enter a backup file path.");
    await invoke("backup_database", { destination: path });
    toast("Database backup created.");
  });
  on("activationRestore", "click", async () => {
    const path = document.getElementById("activationBackupPath")?.value?.trim();
    if (!path) throw new Error("Enter the backup file path.");
    if (!confirm("Restore this backup now? Current database contents may be overwritten.")) return;
    await invoke("restore_database", { source: path });
    toast("Database restored. Restart NATRA before continuing.");
  });
}

async function activateCloudSync() {
  const root = page("settings");
  if (!root || root.querySelector("[data-activation-cloud]")) return;
  const el = document.createElement("div");
  el.className = "card panel";
  el.dataset.activationCloud = "1";
  el.innerHTML = `<div class="panel-title">Cloud Sync Configuration</div><div class="form-grid"><div class="form-field wide-field"><label>Turso / libSQL URL</label><input id="activationCloudUrl" placeholder="libsql://your-database.turso.io"></div><div class="form-field wide-field"><label>Turso auth token</label><input id="activationCloudToken" type="password" autocomplete="new-password" placeholder="Paste company-specific token"></div></div><div class="modal-actions"><button class="btn primary" id="activationCloudSave">Save Cloud Settings</button><button class="btn" id="activationCloudCheck">Check Status</button></div><div id="activationCloudStatus" class="info-box">Checking configuration…</div>`;
  root.appendChild(el);
  const statusEl = () => document.getElementById("activationCloudStatus");
  const check = async () => {
    const status = await invoke("get_cloud_sync_config");
    if (document.getElementById("activationCloudUrl") && status.url) document.getElementById("activationCloudUrl").value = status.url;
    const s = statusEl();
    if (s) s.textContent = status.configured ? "Cloud credentials are configured. Restart NATRA to use the cloud database." : "Cloud credentials are not configured; NATRA will use the local database.";
  };
  on("activationCloudCheck", "click", check);
  on("activationCloudSave", "click", async () => {
    const url = document.getElementById("activationCloudUrl")?.value?.trim() || "";
    const token = document.getElementById("activationCloudToken")?.value?.trim() || "";
    if (!url || !token) throw new Error("Enter both the Turso URL and company-specific auth token.");
    await invoke("configure_cloud_sync", { url, token });
    const s = statusEl(); if (s) s.textContent = "Cloud credentials saved securely. Restart NATRA to switch to the synced database.";
    const t = document.getElementById("activationCloudToken"); if (t) t.value = "";
    toast("Cloud sync settings saved.");
  });
  await check();
}

function activateReceiptSupport() {
  window.NATRA_PRODUCTION.receiptHtml = receiptHtml;
  window.NATRA_PRODUCTION.printReceipt = printReceipt;
  window.NATRA_PRODUCTION.makeReceipt = receipt => receiptHtml(receipt);
}

async function refreshSyncStatus() {
  try {
    const status = await getSyncStatus();
    window.NATRA_PRODUCTION.syncStatus = status;
    const detail = document.querySelector("#modeDetail");
    if (detail && status) {
      if (status.mode) detail.textContent = `Database: ${status.mode === "cloud" ? "cloud sync" : "inventory.db"}`;
      else if (status.status) detail.textContent = `Sync: ${status.status}`;
    }
  } catch (_) {}
}

function exposeProductionApi() {
  window.NATRA_PRODUCTION = window.NATRA_PRODUCTION || {};
  window.NATRA_PRODUCTION.money = money;
  window.NATRA_PRODUCTION.refreshSyncStatus = refreshSyncStatus;
  window.NATRA_PRODUCTION.refreshReports = activateReports;
  window.NATRA_PRODUCTION.recordCustomerPayment = recordCustomerPayment;
  window.NATRA_PRODUCTION.listSuppliers = listSuppliers;
}

function statusBadge(status){ const s=String(status||"").toLowerCase(); const cls=s.includes("low")||s.includes("out")||s.includes("refund")?"red":s.includes("pending")||s.includes("receivable")?"amber":s.includes("complete")||s.includes("clear")||s.includes("active")?"green":"blue"; return `<span class="badge ${cls}">${esc(status)}</span>`; }

async function boot() {
  exposeProductionApi();
  activateReceiptSupport();
  await Promise.allSettled([
    loadProducts(),
    activateReports(),
    activateCustomers(),
    activateSuppliers(),
    activateCategories(),
    activateAdjustments(),
    activateMovement(),
    activateSalesHistory(),
    activateReturns(),
    activatePurchases(),
    activatePurchaseHistory(),
    activateTransactions(),
    activateIncome(),
    activateExpenses(),
    activateTransfers(),
    activateCashflow(),
    activateBackup(),
    activateCloudSync()
  ]);
  await refreshSyncStatus();
  setInterval(refreshSyncStatus, 30000);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0), { once: true });
else setTimeout(boot, 0);
