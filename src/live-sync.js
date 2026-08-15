import { invoke } from "@tauri-apps/api/core";

const money = (n) => `ETB ${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
let lastSignature = "";
let decorating = false;

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
    @media(max-width:900px){.natra-cart-head,.natra-cart-live-row{grid-template-columns:minmax(110px,1fr) 78px 72px 88px 30px;gap:5px}.natra-qty{width:62px}}
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
    const strong = row.querySelector("strong");
    const qtyText = first?.querySelector("small")?.textContent || "1 × ETB 0";
    const match = qtyText.match(/^\s*([0-9.]+)\s*[×x]\s*/i);
    const qty = Number(match?.[1] || 1);
    const price = Number(product?.price ?? String(qtyText).replace(/^.*?×\s*ETB\s*/i, "") || 0) / 1;
    const name = first?.querySelector("b")?.textContent || product?.name || sku;
    row.classList.add("natra-cart-live-row");
    row.innerHTML = `
      <div><b>${name}</b><small>${sku}</small></div>
      <div class="natra-cart-price">${money(price)}</div>
      <input class="natra-qty" type="number" min="1" step="1" value="${qty}" data-live-qty="${sku}" aria-label="Quantity for ${name}">
      <div class="natra-cart-amount" data-live-amount="${sku}">${money(qty * price)}</div>
      <button class="row-btn danger" data-remove-cart="${sku}" title="Remove">×</button>`;
    strong?.remove();
  });
  decorating = false;
}

async function setCartQuantity(sku, wanted) {
  wanted = Math.max(1, Math.floor(Number(wanted) || 1));
  const row = document.querySelector(`[data-live-qty="${CSS.escape(sku)}"]`)?.closest(".cart-row");
  if (!row) return;
  const qty = Math.max(1, Math.floor(Number(row.querySelector(".natra-qty")?.value) || 1));
  if (qty === wanted) return;
  const remove = row.querySelector("[data-remove-cart]");
  if (!remove) return;
  remove.click();
  await new Promise((r) => setTimeout(r, 0));
  const tile = productTile(sku);
  if (!tile) {
    const search = document.querySelector("#posSearch");
    if (search) {
      search.value = sku;
      search.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  const target = productTile(sku);
  if (!target) return;
  for (let i = 0; i < wanted; i++) target.click();
}

function liveInputHandler(e) {
  const qty = e.target.closest?.("[data-live-qty]");
  if (!qty) return;
  const sku = qty.dataset.liveQty;
  const row = qty.closest(".cart-row");
  const product = window.__natraLiveProducts?.find((p) => String(p.sku) === String(sku));
  const amount = row?.querySelector("[data-live-amount]");
  if (amount) amount.textContent = money(Number(qty.value || 0) * Number(product?.price || 0));
}

document.addEventListener("change", async (e) => {
  const qty = e.target.closest?.("[data-live-qty]");
  if (!qty) return;
  await setCartQuantity(qty.dataset.liveQty, qty.value);
});

document.addEventListener("input", liveInputHandler);

document.addEventListener("click", (e) => {
  const tile = e.target.closest?.("[data-add-cart]");
  if (tile) setTimeout(decorateCart, 0);
  const remove = e.target.closest?.("[data-remove-cart]");
  if (remove) setTimeout(decorateCart, 0);
});

const cartObserver = new MutationObserver(() => decorateCart());

async function refreshIfChanged() {
  try {
    const [products, transactions] = await Promise.all([
      invoke("list_products"),
      invoke("list_transactions")
    ]);
    window.__natraLiveProducts = products || [];
    const signature = JSON.stringify({
      products: (products || []).map(p => [p.sku, p.stock, p.price, p.cost, p.min_stock]),
      transactions: (transactions || []).map(t => [t.reference, t.tx_type, t.amount, t.created_at]).slice(0, 100)
    });
    const changed = lastSignature && signature !== lastSignature;
    lastSignature = signature;
    if (changed && !userIsEditing()) {
      const page = activePage();
      const nav = document.querySelector(`[data-page="${CSS.escape(page)}"]`);
      if (nav) nav.click();
    }
    decorateCart();
  } catch (_) {}
}

async function boot() {
  injectStyles();
  window.__natraLiveProducts = await invoke("list_products").catch(() => []);
  const body = document.querySelector("#cartBody");
  if (body) cartObserver.observe(body, { childList: true, subtree: true });
  decorateCart();
  await refreshIfChanged();
  setInterval(refreshIfChanged, 2000);
  setInterval(decorateCart, 500);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
