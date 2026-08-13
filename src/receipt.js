
export function receiptHtml({businessName="Smart Inventory Pro", reference, date, items=[], total=0, payment="Cash"}) {
  return `<!doctype html><html><head><title>${reference}</title>
  <style>
    body{font-family:Arial,sans-serif;width:72mm;margin:0 auto;font-size:12px}
    h2{text-align:center;margin:8px 0}.muted{color:#555;font-size:10px}
    .row{display:flex;justify-content:space-between;margin:5px 0}
    .line{border-top:1px dashed #777;margin:7px 0}.total{font-size:16px;font-weight:700}
    @media print{body{width:72mm}}
  </style></head><body>
  <h2>${businessName}</h2><div class="muted">${reference}<br>${date}</div>
  <div class="line"></div>
  ${items.map(i=>`<div>${i.name}<div class="row"><span>${i.qty} × ${i.unit_price}</span><b>${i.line_total}</b></div></div>`).join("")}
  <div class="line"></div><div class="row total"><span>TOTAL</span><span>${total}</span></div>
  <div class="row"><span>Payment</span><span>${payment}</span></div>
  <p style="text-align:center;margin-top:14px">Thank you!</p>
  </body></html>`;
}
