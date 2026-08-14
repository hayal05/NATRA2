import { invoke } from "@tauri-apps/api/core";

const money = n => `ETB ${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const esc = s => String(s ?? "").replace(/[&<>\"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));

function total() {
  const cart = window.__natraCartForCredit || [];
  return cart.reduce((s, p) => s + Number(p.qty || 0) * Number(p.price || 0), 0);
}
function toastCompat(message) {
  const el = document.querySelector("#toast");
  if (el) { el.textContent = message; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 2600); }
}
function loadSaleCustomers() {
  const select = document.querySelector("#saleCustomer");
  if (!select) return;
  return invoke("list_customers").then(customers => {
    const current = select.value;
    select.innerHTML = `<option value="">Walk-in Customer</option>${(customers || []).map(c => `<option value="${c.id}">${esc(c.name)} · Balance ${money(c.balance)} / Limit ${money(c.credit_limit)}</option>`).join("")}`;
    if ([...select.options].some(o => o.value === current)) select.value = current;
  }).catch(() => {});
}
function updateCreditControls() {
  const method = document.querySelector("#paymentMethod");
  if (!method) return;
  if (![...method.options].some(o => o.value === "Credit")) method.add(new Option("Credit", "Credit"));
  let wrap = document.querySelector("#creditSaleControls");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "creditSaleControls";
    wrap.innerHTML = `<div class="form-field" style="margin-top:8px"><label>Amount paid now</label><input class="field full" id="creditPaidAmount" type="number" min="0" step="0.01" value="0"></div><div class="form-field" style="margin-top:8px"><label>Payment account</label><select class="field full" id="creditPaymentAccount"><option>Cash</option><option>Bank</option><option>Mobile Money</option></select></div><div class="info-box" id="creditBalanceInfo" style="margin-top:8px"></div>`;
    method.after(wrap);
    wrap.querySelector("#creditPaidAmount").addEventListener("input", updateCreditControls);
  }
  const credit = method.value === "Credit";
  wrap.style.display = credit ? "block" : "none";
  const paid = wrap.querySelector("#creditPaidAmount");
  const t = total();
  if (paid) { paid.max = String(t); if (Number(paid.value) > t) paid.value = String(t); }
  const p = credit ? Number(paid?.value || 0) : t;
  const info = wrap.querySelector("#creditBalanceInfo");
  if (info) info.textContent = `Sale total: ${money(t)} · Paid now: ${money(p)} · Receivable: ${money(Math.max(0, t - p))}`;
  method.onchange = updateCreditControls;
}
function replaceSaleHandler() {
  const old = document.querySelector("#completeSale");
  if (!old || old.dataset.creditHandler === "1") return;
  const button = old.cloneNode(true);
  old.replaceWith(button);
  button.dataset.creditHandler = "1";
  button.addEventListener("click", async () => {
    const cart = window.__natraCartForCredit || [];
    if (!cart.length) return toastCompat("Add at least one product.");
    const method = document.querySelector("#paymentMethod")?.value || "Cash";
    const customerId = Number(document.querySelector("#saleCustomer")?.value || 0) || null;
    const t = total();
    const paid = method === "Credit" ? Number(document.querySelector("#creditPaidAmount")?.value || 0) : t;
    if (method === "Credit" && !customerId) return toastCompat("Select a customer for a credit sale.");
    if (!Number.isFinite(paid) || paid < 0 || paid > t + 0.005) return toastCompat("Paid amount must be between zero and the sale total.");
    try {
      const ref = await invoke("record_sale", { input: { items: cart.map(p => ({ sku:p.sku, qty:p.qty, unit_price:p.price })), payment_method:method, customer_id:customerId, paid_amount:paid, payment_account:method === "Credit" ? (document.querySelector("#creditPaymentAccount")?.value || "Cash") : method } });
      window.__natraCartForCredit = [];
      document.querySelector("#cartBody").innerHTML = `<div class="empty">Cart is empty.</div>`;
      document.querySelector("#cartCount").textContent = "0 items";
      document.querySelector("#cartSubtotal").textContent = money(0);
      document.querySelector("#cartTotal").textContent = money(0);
      toastCompat(`Sale ${ref} recorded locally.`);
      await loadSaleCustomers();
      updateCreditControls();
    } catch (e) { toastCompat(String(e)); }
  });
}
function bridgeCart() {
  if (window.__natraCreditBridge) return;
  window.__natraCreditBridge = true;
  window.__natraCartForCredit = [];
  document.addEventListener("click", e => {
    const add = e.target.closest("[data-add-cart]");
    if (add) {
      const sku = add.dataset.addCart;
      const price = Number((add.querySelector("strong")?.textContent || "0").replace(/[^0-9.-]/g, "")) || 0;
      const item = window.__natraCartForCredit.find(p => p.sku === sku);
      if (item) item.qty += 1; else window.__natraCartForCredit.push({ sku, price, qty:1 });
    }
    const remove = e.target.closest("[data-remove-cart]");
    if (remove) {
      const item = window.__natraCartForCredit.find(p => p.sku === remove.dataset.removeCart);
      if (item) { item.qty -= 1; if (item.qty <= 0) window.__natraCartForCredit = window.__natraCartForCredit.filter(p => p.sku !== item.sku); }
    }
    setTimeout(updateCreditControls, 0);
  });
}
function boot(){ bridgeCart(); updateCreditControls(); replaceSaleHandler(); loadSaleCustomers(); setInterval(() => { updateCreditControls(); replaceSaleHandler(); loadSaleCustomers(); }, 1500); }
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, {once:true}); else boot();
