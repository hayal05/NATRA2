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
function addAction(id, text, handler) {
  const root = page(id);
  if (!root || root.querySelector(`[data-activation-action="${id}-${text}"]`)) return;
  const actions = root.querySelector(".page-head .actions");
  if (!actions) return;
  const b = document.createElement("button");
  b.className = "btn";
  b.dataset.activationAction = `${id}-${text}`;
  b.textContent = text;
  b.addEventListener("click", () => Promise.resolve(handler()).catch(e => toast(e?.message || String(e))));
  actions.appendChild(b);
}

async function activateReports() {
  addAction("reports", "Refresh Summary", async () => {
    const summary = await getDashboardSummary();
    toast("Dashboard summary refreshed.");
    window.NATRA_PRODUCTION.lastDashboardSummary = summary;
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
    const names = customers.map((c, i) => `${i + 1}. ${c.name || c.customer_name || `Customer ${c.id}`}`).join("\n");
    const choice = Number(prompt(`Select customer number:\n\n${names}`));
    if (!Number.isInteger(choice) || choice < 1 || choice > customers.length) return;
    const customer = customers[choice - 1];
    const amount = Number(prompt(`Payment amount for ${customer.name || customer.customer_name}:`));
    if (!(amount > 0)) throw new Error("Enter a payment amount greater than zero.");
    const account = prompt("Account (Cash / Bank / Mobile):", "Cash") || "Cash";
    const note = prompt("Note (optional):", "Customer payment") || "";
    await recordCustomerPayment(customer.id, amount, account, note);
    toast(`Recorded ${money(amount)} payment for ${customer.name || customer.customer_name}.`);
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
      if (typeof status === "string") detail.textContent = `Sync: ${status}`;
      else if (status.status) detail.textContent = `Sync: ${status.status}`;
      else if (status.pending != null) detail.textContent = `Sync pending: ${status.pending}`;
    }
  } catch (_) {
    // Sync is optional while the app is offline; don't block the UI.
  }
}

function exposeProductionApi() {
  window.NATRA_PRODUCTION = window.NATRA_PRODUCTION || {};
  window.NATRA_PRODUCTION.money = money;
  window.NATRA_PRODUCTION.refreshSyncStatus = refreshSyncStatus;
  window.NATRA_PRODUCTION.refreshReports = activateReports;
  window.NATRA_PRODUCTION.recordCustomerPayment = recordCustomerPayment;
  window.NATRA_PRODUCTION.listSuppliers = listSuppliers;
}

async function boot() {
  exposeProductionApi();
  activateReceiptSupport();
  await activateReports();
  await activateCustomers();
  await activateSuppliers();
  await refreshSyncStatus();
  setInterval(refreshSyncStatus, 30000);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0), { once: true });
else setTimeout(boot, 0);
