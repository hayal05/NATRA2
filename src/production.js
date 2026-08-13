
/**
 * v0.5 production UI helpers.
 * Import from main.js when wiring the final screens.
 */
import { invoke } from "@tauri-apps/api/core";

export async function recordCustomerPayment(customerId, amount, account = "Cash", note = "") {
  return invoke("record_customer_payment", {
    p: { customer_id: Number(customerId), amount: Number(amount), account, note }
  });
}

export async function createSupplier(input) {
  return invoke("create_supplier", { input });
}

export async function listSuppliers() {
  return invoke("list_suppliers");
}

export async function backupDatabase(destination) {
  return invoke("backup_database", { destination });
}

export async function getSyncStatus() {
  return invoke("sync_status");
}

export function printReceipt(receiptHtml) {
  const w = window.open("", "_blank", "width=420,height=720");
  if (!w) throw new Error("Popup blocked. Allow popups to print receipts.");
  w.document.write(receiptHtml);
  w.document.close();
  w.focus();
  w.print();
}
