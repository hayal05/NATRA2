import { invoke } from "@tauri-apps/api/core";
import { downloadCSV } from "./reports.js";

const SUPPORT = "+251988416048";
const esc = s => String(s ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));

function style(){
  if(document.getElementById("natraHelpNotifyStyles")) return;
  const s=document.createElement("style"); s.id="natraHelpNotifyStyles"; s.textContent=`
    .natra-overlay{position:fixed;inset:0;background:rgba(4,20,40,.46);display:none;align-items:flex-start;justify-content:flex-end;padding:70px 22px 22px;z-index:100}
    .natra-overlay.open{display:flex}.natra-pop{width:390px;max-width:calc(100vw - 30px);max-height:calc(100vh - 100px);overflow:auto;background:#fff;border:1px solid #e3e8f0;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.2);padding:16px}
    .natra-pop-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.natra-pop h3{margin:0;font-size:15px;color:#17233a}.natra-close{border:0;background:#f4f7fb;border-radius:7px;width:30px;height:30px;cursor:pointer;color:#4e6078}
    .natra-help-section{padding:10px 0;border-bottom:1px solid #edf0f4}.natra-help-section:last-child{border-bottom:0}.natra-help-section b{font-size:11px}.natra-help-section p,.natra-help-section li{font-size:10px;color:#718097;line-height:1.55}.natra-support{display:inline-flex;margin-top:8px;padding:8px 11px;border-radius:8px;background:#246bfd;color:#fff;text-decoration:none;font-size:10px;font-weight:800}
    .natra-notice{display:flex;gap:9px;padding:10px 0;border-bottom:1px solid #edf0f4}.natra-notice:last-child{border-bottom:0}.natra-notice b{font-size:10px}.natra-notice small{display:block;color:#8390a1;font-size:8px;margin-top:3px}.natra-notice-dot{width:8px;height:8px;border-radius:50%;background:#246bfd;margin-top:4px;flex:none}.natra-notice.read .natra-notice-dot{background:#cbd5e1}.natra-notify-actions{display:flex;gap:7px;margin-bottom:8px}.natra-notify-actions button{flex:1}
    .natra-export-btn{margin-left:7px}
  `; document.head.appendChild(s);
}

function overlay(id,title,body){
  let o=document.getElementById(id); if(!o){o=document.createElement("div");o.id=id;o.className="natra-overlay";o.innerHTML=`<div class="natra-pop"><div class="natra-pop-head"><h3>${title}</h3><button class="natra-close" data-close="${id}">×</button></div><div class="natra-pop-body">${body}</div></div>`;document.body.appendChild(o);}
  return o;
}

function closeOverlays(){document.querySelectorAll(".natra-overlay.open").forEach(x=>x.classList.remove("open"));}

function openHelp(){
  const o=overlay("natraHelp","NATRA Help",`<div class="natra-help-section"><b>Dashboard</b><p>Use the dashboard to review sales, profit, stock value, cash flow and alerts. Use the date controls to change the reporting period.</p></div><div class="natra-help-section"><b>Inventory & Sales</b><p>Products show current stock and value. New Sales reduce stock automatically; purchases and approved returns restore or increase stock.</p></div><div class="natra-help-section"><b>Reports</b><p>Open Reports to review business performance. Use Export CSV to save the visible report data for Excel or other spreadsheet software.</p></div><div class="natra-help-section"><b>Offline operation</b><p>NATRA is designed to continue working with the local database when cloud connectivity is unavailable.</p></div><div class="natra-help-section"><b>Support</b><p>For NATRA support, contact the support line below.</p><a class="natra-support" href="tel:${SUPPORT}">Call Support · ${SUPPORT}</a></div>`);
  o.classList.add("open");
}

async function getNotifications(){
  const notes=[];
  try{
    const products=await invoke("list_products");
    for(const p of (Array.isArray(products)?products:[])){
      const stock=Number(p.stock||0), min=Number(p.min_stock||0);
      if(stock<=0) notes.push({key:`out-${p.sku}`,title:`${p.name} is out of stock`,detail:`SKU ${p.sku} needs replenishment.`,target:"lowstock"});
      else if(stock<=min) notes.push({key:`low-${p.sku}`,title:`${p.name} is low on stock`,detail:`${stock} remaining; minimum is ${min}.`,target:"lowstock"});
    }
  }catch(_){notes.push({key:"db-warning",title:"Inventory status unavailable",detail:"NATRA could not read inventory data right now.",target:"products"});}
  try{const status=await invoke("sync_status");if(status?.open_conflicts>0)notes.push({key:"sync-conflicts",title:"Sync conflicts need attention",detail:`${status.open_conflicts} open sync conflict(s).`,target:"settings"});}catch(_){ }
  return notes;
}

async function openNotifications(){
  const o=overlay("natraNotifications","Notifications",`<div class="natra-notify-actions"><button class="btn" id="natraRefreshNotifications">Refresh</button><button class="btn" id="natraReadNotifications">Mark all as read</button></div><div id="natraNotificationList" class="empty">Loading…</div>`);
  o.classList.add("open");
  const list=o.querySelector("#natraNotificationList");
  const read=new Set(JSON.parse(localStorage.getItem("natra.readNotifications")||"[]"));
  const notes=await getNotifications();
  if(!notes.length){list.innerHTML=`<div class="natra-help-section"><b>All clear</b><p>No current business notifications.</p></div>`;updateBadge(0);return;}
  list.innerHTML=notes.map(n=>`<div class="natra-notice ${read.has(n.key)?"read":""}" data-note="${esc(n.key)}" data-target="${esc(n.target)}"><span class="natra-notice-dot"></span><div><b>${esc(n.title)}</b><small>${esc(n.detail)}</small></div></div>`).join("");
  const unread=notes.filter(n=>!read.has(n.key)).length;updateBadge(unread);
  o.querySelector("#natraRefreshNotifications")?.addEventListener("click",openNotifications,{once:true});
  o.querySelector("#natraReadNotifications")?.addEventListener("click",()=>{notes.forEach(n=>read.add(n.key));localStorage.setItem("natra.readNotifications",JSON.stringify([...read]));openNotifications();});
  list.querySelectorAll(".natra-notice").forEach(n=>n.addEventListener("click",()=>{read.add(n.dataset.note);localStorage.setItem("natra.readNotifications",JSON.stringify([...read]));closeOverlays();document.querySelector(`[data-page="${n.dataset.target}"]`)?.click();}));
}

function updateBadge(count){
  const b=document.querySelector(".notify-dot");if(!b)return;b.textContent=String(Math.min(99,count));b.style.display=count?"block":"none";
}

function tableRows(table){
  const headers=[...table.querySelectorAll("thead th")].map(x=>x.textContent.trim());
  return [...table.querySelectorAll("tbody tr")].filter(tr=>tr.querySelectorAll("td").length).map(tr=>{const cells=[...tr.querySelectorAll("td")].map(x=>x.textContent.trim());return Object.fromEntries(headers.map((h,i)=>[h||`Column ${i+1}`,cells[i]??""]));});
}

function exportReports(){
  const root=document.querySelector("#page-reports");if(!root)return;
  const tables=[...root.querySelectorAll("table")];
  const rows=[];
  for(const table of tables) rows.push(...tableRows(table));
  if(!rows.length){
    const stats=[...root.querySelectorAll("#reportStats .stat")].map(s=>{const l=s.querySelector(".kpi-label")?.textContent||"Metric";const v=s.querySelector("b")?.textContent||"";return {Metric:l,Value:v};});
    if(stats.length) downloadCSV(`natra-report-${new Date().toISOString().slice(0,10)}.csv`,stats); else throw new Error("There is no report data to export.");
  }else downloadCSV(`natra-report-${new Date().toISOString().slice(0,10)}.csv`,rows);
  const t=document.getElementById("toast");if(t){t.textContent="Report exported as CSV.";t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2500);}
}

function ensureReportExport(){
  const root=document.querySelector("#page-reports");if(!root)return;
  const actions=root.querySelector(".page-head .actions");if(!actions)return;
  let b=actions.querySelector("#natraReportExport");if(!b){b=document.createElement("button");b.id="natraReportExport";b.className="btn primary natra-export-btn";b.textContent="Export CSV";actions.appendChild(b);b.addEventListener("click",()=>{try{exportReports()}catch(e){alert(e.message||String(e))}});}
}

function boot(){
  style();
  const actions=document.querySelector(".top-actions");
  if(actions){const buttons=actions.querySelectorAll(".icon-btn");if(buttons[0]&&!buttons[0].dataset.natraNotifications){buttons[0].dataset.natraNotifications="1";buttons[0].addEventListener("click",e=>{e.stopPropagation();openNotifications()});}if(buttons[2]&&!buttons[2].dataset.natraHelp){buttons[2].dataset.natraHelp="1";buttons[2].addEventListener("click",e=>{e.stopPropagation();openHelp()});}}
  ensureReportExport();
  const obs=new MutationObserver(()=>ensureReportExport());obs.observe(document.getElementById("content")||document.body,{childList:true,subtree:true});
  document.addEventListener("click",e=>{if(e.target.closest("[data-close]")){document.getElementById(e.target.closest("[data-close]").dataset.close)?.classList.remove("open");}else if(e.target.classList.contains("natra-overlay"))e.target.classList.remove("open");});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeOverlays();});
  getNotifications().then(n=>{const read=new Set(JSON.parse(localStorage.getItem("natra.readNotifications")||"[]"));updateBadge(n.filter(x=>!read.has(x.key)).length)}).catch(()=>{});
  setInterval(()=>getNotifications().then(n=>{const read=new Set(JSON.parse(localStorage.getItem("natra.readNotifications")||"[]"));updateBadge(n.filter(x=>!read.has(x.key)).length)}).catch(()=>{}),30000);
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>setTimeout(boot,100),{once:true});else setTimeout(boot,100);
