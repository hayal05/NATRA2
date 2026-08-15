import { invoke } from "@tauri-apps/api/core";

const money = (n) => `ETB ${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
let lastSignature = "";
let decorating = false;
let purchaseSignatureBeforeSave = "";

function activePage() {
  return document.querySelector(".page.active")?.id?.replace("page-", "") || "";
}

function userIsEditing() {
  const el = document.activeElement;
  return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.matches("#posSearch");
}

function injectStyles() {
  if (document.getElementById("natraLiveSyncStyles")) return;
  const style = document.createElement("style");
  style.id = "natraLiveSyncStyles";
  style.textContent = `
    .natra-cart-head{display:grid;grid-template-columns:minmax(130px,1fr) 92px 88px 104px 34px;gap:8px;align-items:center;padding:7px 10px;margin-bottom:4px;border-bottom:1px solid rgba(148,163,184,.18);font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
    .natra-cart-live-row{display:grid!important;grid-template-columns:minmax(130px,1fr) 92px 88px 104px 34px;gap:8px;align-items:center}
    .natra-cart-price,.natra-cart-amount{font-weight:700;white-space:nowrap}
    .natra-qty{width:76px;height:32px;border:1px solid rgba(148,163,184,.28);border-radius:8px;background:rgba(15,23,42,.25);color:inherit;text-align:center;font-weight:700}
    .natra-cart-live-row small{display:block;color:#94a3b8;margin-top:2px}
    .natra-purchase-meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
    .natra-purchase-meta .form-field{min-width:0}
    .natra-purchase-meta input{width:100%;box-sizing:border-box}
    .natra-purchase-total-live{font-weight:800}
    @media(max-width:900px){.natra-cart-head,.natra-cart-live-row{grid-template-columns:minmax(110px,1fr) 78px 72px 88px 30px;gap:5px}.natra-qty{width:62px}.natra-purchase-meta{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function productTile(sku) {
  return [...document.querySelectorAll("[data-add-cart]")].find((b) => b.dataset.addCart === sku);
}

function decorateCart() {
  const body = document.querySelector("#cartBody");
  if (!body || decorating) return;
  const rows = [...body.querySelectorAll(".cart-row")];
  if (!rows.length) {
    body.querySelector(".natra-cart-head")?.remove();
    return;
  }
  decorating = true;
  let head = body.querySelector(".natra-cart-head");
  if (!head) {
    head = document.createElement("div");
    head.className = "natra-cart-head";
    head.innerHTML = "<span>Product</span><span>Unit Price</span><span>Quantity</span><span>Amount</span><span></span>";
    body.prepend(head);
  }
  rows.forEach((row) => {
    if (row.classList.contains("natra-cart-live-row")) return;
    const remove = row.querySelector("[data-remove-cart]");
    const sku = remove?.dataset.removeCart;
    if (!sku) return;
    const product = window.__natraLiveProducts?.find((p) => String(p.sku) === String(sku));
    const first = row.firstElementChild;
    const qtyText = first?.querySelector("small")?.textContent || "1 × ETB 0";
    const match = qtyText.match(/^\s*([0-9.]+)\s*[×x]\s*/i);
    const qty = Number(match?.[1] || 1);
    const fallbackPrice = Number(String(qtyText).replace(/^.*?[×x]\s*ETB\s*/i, "")) || 0;
    const price = Number(product?.price ?? fallbackPrice);
    const name = first?.querySelector("b")?.textContent || product?.name || sku;
    row.classList.add("natra-cart-live-row");
    row.innerHTML = `
      <div><b>${name}</b><small>${sku}</small></div>
      <div class="natra-cart-price">${money(price)}</div>
      <input class="natra-qty" type="number" min="1" step="1" value="${qty}" data-live-qty="${sku}" data-live-current-qty="${qty}" aria-label="Quantity for ${name}">
      <div class="natra-cart-amount" data-live-amount="${sku}">${money(qty * price)}</div>
      <button class="row-btn danger" data-remove-cart="${sku}" title="Remove">×</button>`;
  });
  decorating = false;
}

function ensurePurchaseUI() {
  const sku = document.querySelector("#purchaseSku");
  if (!sku) return;
  const field = sku.closest(".form-field");
  if (!field) return;
  if (!document.querySelector("#purchaseProductName")) {
    const meta = document.createElement("div");
    meta.className = "natra-purchase-meta";
    meta.innerHTML = `
      <div class="form-field"><label>Product name</label><input id="purchaseProductName" readonly aria-readonly="true"></div>
      <div class="form-field"><label>Product category</label><input id="purchaseProductCategory" readonly aria-readonly="true"></div>`;
    field.after(meta);
  }
  const total = document.querySelector("#purchaseTotal");
  if (total) total.classList.add("natra-purchase-total-live");
  updatePurchaseForm();
}

function selectedPurchaseProduct() {
  const sku = document.querySelector("#purchaseSku")?.value;
  return window.__natraLiveProducts?.find((p) => String(p.sku) === String(sku)) || null;
}

function updatePurchaseForm() {
  const sku = document.querySelector("#purchaseSku");
  const qty = document.querySelector("#purchaseQty");
  const cost = document.querySelector("#purchaseCost");
  const total = document.querySelector("#purchaseTotal");
  const name = document.querySelector("#purchaseProductName");
  const category = document.querySelector("#purchaseProductCategory");
  if (!sku || !qty || !cost || !total) return;
  const product = selectedPurchaseProduct();
  if (product) {
    if (document.activeElement !== cost || !cost.value) cost.value = Number(product.cost || 0);
    if (name) name.value = product.name || "";
    if (category) category.value = product.category || "";
  } else {
    if (name) name.value = "";
    if (category) category.value = "";
  }
  total.textContent = money(Number(qty.value || 0) * Number(cost.value || 0));
}

async function setCartQuantity(sku, current, wanted) {
  current = Math.max(1, Math.floor(Number(current) || 1));
  wanted = Math.max(1, Math.floor(Number(wanted) || 1));
  if (current === wanted) return;
  const row = document.querySelector(`[data-live-qty="${CSS.escape(sku)}"]`)?.closest(".cart-row");
  const remove = row?.querySelector("[data-remove-cart]");
  if (!remove) return;
  remove.click();
  await new Promise((r) => setTimeout(r, 0));
  const search = document.querySelector("#posSearch");
  let target = productTile(sku);
  if (!target && search) {
    search.value = sku;
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    target = productTile(sku);
  }
  if (!target) return;
  for (let i = 0; i < wanted; i++) target.click();
}

function liveInputHandler(e) {
  const qty = e.target.closest?.("[data-live-qty]");
  if (qty) {
    const sku = qty.dataset.liveQty;
    const row = qty.closest(".cart-row");
    const product = window.__natraLiveProducts?.find((p) => String(p.sku) === String(sku));
    const amount = row?.querySelector("[data-live-amount]");
    if (amount) amount.textContent = money(Number(qty.value || 0) * Number(product?.price || 0));
  }
  if (e.target.matches?.("#purchaseQty,#purchaseCost")) updatePurchaseForm();
}

document.addEventListener("change", async (e) => {
  const qty = e.target.closest?.("[data-live-qty]");
  if (qty) {
    const current = Number(qty.dataset.liveCurrentQty || 1);
    const wanted = Number(qty.value || 1);
    qty.dataset.liveCurrentQty = String(Math.max(1, Math.floor(wanted)));
    await setCartQuantity(qty.dataset.liveQty, current, wanted);
    setTimeout(decorateCart, 0);
    return;
  }
  if (e.target.matches?.("#purchaseSku")) updatePurchaseForm();
});

document.addEventListener("input", liveInputHandler);
document.addEventListener("click", (e) => {
  const tile = e.target.closest?.("[data-add-cart]");
  if (tile) setTimeout(decorateCart, 0);
  const remove = e.target.closest?.("[data-remove-cart]");
  if (remove) setTimeout(decorateCart, 0);

  const purchaseButton = e.target.closest?.("#recordPurchase");
  if (purchaseButton) {
    purchaseSignatureBeforeSave = lastSignature;
    setTimeout(() => watchPurchaseCommit(0), 250);
  }
});

const cartObserver = new MutationObserver(() => decorateCart());

async function watchPurchaseCommit(attempt) {
  if (attempt > 15) return;
  try {
    const products = await invoke("list_products");
    const transactions = await invoke("list_transactions");
    const signature = JSON.stringify({
      products: (products || []).map(p => [p.sku, p.stock, p.price, p.cost, p.min_stock]),
      transactions: (transactions || []).map(t => [t.reference, t.tx_type, t.amount, t.created_at]).slice(0, 100)
    });
    window.__natraLiveProducts = products || [];
    if (signature !== purchaseSignatureBeforeSave) {
      lastSignature = signature;
      ensurePurchaseUI();
      updatePurchaseForm();
      window.dispatchEvent(new CustomEvent("natra:data-changed", { detail: { source: "purchase", products, transactions } }));
      const page = activePage();
      if (page === "products") {
        document.querySelector(`[data-page="products"]`)?.click();
      }
      return;
    }
  } catch (_) {}
  setTimeout(() => watchPurchaseCommit(attempt + 1), 200);
}

async function refreshIfChanged() {
  try {
    const [products, transactions] = await Promise.all([invoke("list_products"), invoke("list_transactions")]);
    window.__natraLiveProducts = products || [];
    const signature = JSON.stringify({
      products: (products || []).map(p => [p.sku, p.stock, p.price, p.cost, p.min_stock]),
      transactions: (transactions || []).map(t => [t.reference, t.tx_type, t.amount, t.created_at]).slice(0, 100)
    });
    const changed = lastSignature && signature !== lastSignature;
    lastSignature = signature;
    ensurePurchaseUI();
    if (changed && !userIsEditing()) {
      const page = activePage();
      const nav = document.querySelector(`[data-page="${CSS.escape(page)}"]`);
      if (nav) nav.click();
    }
    decorateCart();
    updatePurchaseForm();
  } catch (_) {}
}

async function boot() {
  injectStyles();
  window.__natraLiveProducts = await invoke("list_products").catch(() => []);
  const body = document.querySelector("#cartBody");
  if (body) cartObserver.observe(body, { childList: true, subtree: true });
  ensurePurchaseUI();
  decorateCart();
  await refreshIfChanged();
  setInterval(refreshIfChanged, 1000);
  setInterval(decorateCart, 500);
  setInterval(ensurePurchaseUI, 500);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
