import { invoke } from "@tauri-apps/api/core";
import logoUrl from "./assets/logo.png";

const USERS_KEY = "natra.offline.users.v1";
const SESSION_KEY = "natra.offline.session.v1";
const ITERATIONS = 150000;

const esc = (s) => String(s ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#039;"}[c]));
const bytesToBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const base64ToBytes = (value) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const randomId = () => crypto.randomUUID();

function getUsers() { try { return JSON.parse(localStorage.getItem(USERS_KEY) || "[]"); } catch (_) { return []; } }
function saveUsers(users) { localStorage.setItem(USERS_KEY, JSON.stringify(users)); }

async function derivePassword(password, saltBytes) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({name:"PBKDF2", salt:saltBytes, iterations:ITERATIONS, hash:"SHA-256"}, key, 256);
  return new Uint8Array(bits);
}
async function passwordHash(password, saltBytes) { return bytesToBase64(await derivePassword(password, saltBytes)); }
async function passwordsMatch(password, salt, expected) {
  const actual = await derivePassword(password, base64ToBytes(salt));
  const wanted = base64ToBytes(expected);
  if (actual.length !== wanted.length) return false;
  let diff = 0; for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ wanted[i];
  return diff === 0;
}

function ensureStyle() {
  if (document.getElementById("natra-auth-style")) return;
  const style = document.createElement("style");
  style.id = "natra-auth-style";
  style.textContent = `
    #natra-auth-screen{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:radial-gradient(circle at 15% 20%,rgba(36,107,253,.22),transparent 34%),radial-gradient(circle at 90% 85%,rgba(24,166,199,.18),transparent 32%),linear-gradient(135deg,#041b38 0%,#062b57 48%,#071c35 100%);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px;box-sizing:border-box;overflow:auto}
    #natra-auth-screen:before{content:"";position:absolute;inset:0;background:linear-gradient(120deg,transparent 20%,rgba(255,255,255,.035) 50%,transparent 80%);pointer-events:none}
    #natra-auth-screen .auth-layout{position:relative;width:min(900px,100%);display:grid;grid-template-columns:1fr 420px;gap:0;align-items:stretch;filter:drop-shadow(0 30px 70px rgba(0,0,0,.3))}
    #natra-auth-screen .auth-showcase{padding:46px 38px;display:flex;flex-direction:column;justify-content:center;color:#fff;background:linear-gradient(160deg,rgba(255,255,255,.09),rgba(255,255,255,.025));border:1px solid rgba(255,255,255,.12);border-right:0;border-radius:24px 0 0 24px;backdrop-filter:blur(14px)}
    #natra-auth-screen .showcase-logo{width:76px;height:76px;object-fit:contain;margin-bottom:24px;filter:drop-shadow(0 10px 24px rgba(0,0,0,.18))}
    #natra-auth-screen .showcase-title{font-size:38px;line-height:1.04;letter-spacing:-.035em;font-weight:900;margin:0;max-width:360px}
    #natra-auth-screen .showcase-title span{display:block;color:#8db6ff}
    #natra-auth-screen .showcase-copy{color:#b9c9dc;font-size:13px;line-height:1.7;max-width:360px;margin:16px 0 25px}
    #natra-auth-screen .offline-pill{display:inline-flex;align-items:center;gap:7px;width:max-content;padding:7px 11px;border:1px solid rgba(141,182,255,.25);border-radius:999px;background:rgba(36,107,253,.12);color:#dce9ff;font-size:10px;font-weight:800;letter-spacing:.04em}
    #natra-auth-screen .offline-dot{width:7px;height:7px;border-radius:50%;background:#35d28a;box-shadow:0 0 0 4px rgba(53,210,138,.1)}
    #natra-auth-screen .auth-card{background:rgba(255,255,255,.98);border-radius:0 24px 24px 0;padding:34px;box-sizing:border-box;min-height:470px}
    #natra-auth-screen .auth-brand{text-align:center;margin-bottom:22px}
    #natra-auth-screen .auth-brand img{width:54px;height:54px;object-fit:contain;margin-bottom:9px}
    #natra-auth-screen .auth-brand h1{margin:0;font-size:22px;letter-spacing:-.025em;font-weight:900;color:#0b2343}
    #natra-auth-screen .auth-brand p{margin:6px 0 0;color:#667085;font-size:12px}
    #natra-auth-screen .auth-badge{display:inline-flex;margin-top:10px;padding:5px 9px;border-radius:999px;background:#eaf2ff;color:#195dc7;font-size:9px;font-weight:850;letter-spacing:.04em}
    #natra-auth-screen label{display:block;margin:13px 0 6px;font-size:11px;font-weight:800;color:#344054}
    #natra-auth-screen input{width:100%;box-sizing:border-box;padding:12px 13px;border:1px solid #d8dee8;border-radius:10px;outline:none;font-size:13px;background:#fbfcfe;color:#17233a;transition:.16s}
    #natra-auth-screen input:focus{border-color:#246bfd;background:#fff;box-shadow:0 0 0 3px rgba(36,107,253,.12)}
    #natra-auth-screen .password-wrap{position:relative}
    #natra-auth-screen .password-wrap input{padding-right:68px}
    #natra-auth-screen .show-pass{position:absolute;right:8px;top:7px;width:auto;border:0!important;background:transparent!important;color:#5f6f86!important;padding:6px 7px!important;margin:0!important;font-size:10px!important;font-weight:800!important;box-shadow:none!important}
    #natra-auth-screen button{width:100%;border:0;border-radius:10px;padding:12px 14px;margin-top:17px;background:linear-gradient(135deg,#246bfd,#1957d5);color:#fff;font-weight:850;font-size:13px;cursor:pointer;box-shadow:0 8px 18px rgba(36,107,253,.22);transition:transform .15s,box-shadow .15s,filter .15s}
    #natra-auth-screen button:hover{filter:brightness(1.04);transform:translateY(-1px);box-shadow:0 11px 24px rgba(36,107,253,.27)}
    #natra-auth-screen button:active{transform:translateY(0)}
    #natra-auth-screen button.secondary{background:#f1f4f8;color:#344054;box-shadow:none}
    #natra-auth-screen button:disabled{opacity:.6;cursor:wait;transform:none}
    #natra-auth-screen .auth-error{min-height:18px;margin-top:10px;color:#b42318;font-size:11px;text-align:center}
    #natra-auth-screen .auth-note{margin-top:16px;text-align:center;color:#7b8798;font-size:10px;line-height:1.5}
    #natra-auth-screen .auth-switch{margin-top:10px}
    #natra-auth-screen .auth-footer{margin-top:20px;padding-top:13px;border-top:1px solid #edf0f4;text-align:center;color:#8a95a5;font-size:9px}
    @media(max-width:760px){#natra-auth-screen .auth-layout{display:block;width:min(430px,100%)}#natra-auth-screen .auth-showcase{display:none}#natra-auth-screen .auth-card{border-radius:22px;padding:28px 24px;min-height:auto}}
  `;
  document.head.appendChild(style);
}

function passwordField(id, autocomplete) { return `<div class="password-wrap"><input id="${id}" type="password" autocomplete="${autocomplete}" required><button type="button" class="show-pass" data-password="${id}">Show</button></div>`; }
function authShell(cardHtml) {
  const screen = document.getElementById("natra-auth-screen");
  screen.innerHTML = `<div class="auth-layout"><section class="auth-showcase"><img class="showcase-logo" src="${logoUrl}" alt="NATRA logo"><h2 class="showcase-title">Smart business.<span>Simply NATRA.</span></h2><p class="showcase-copy">A professional offline management workspace for inventory, sales, cash flow and business performance.</p><span class="offline-pill"><i class="offline-dot"></i> SECURE LOCAL ACCOUNT • WORKS OFFLINE</span></section>${cardHtml}</div>`;
  screen.querySelectorAll(".show-pass").forEach(button => button.addEventListener("click", () => { const input = screen.querySelector(`#${button.dataset.password}`); if (!input) return; input.type = input.type === "password" ? "text" : "password"; button.textContent = input.type === "password" ? "Show" : "Hide"; }));
}

function setSession(user) {
  const session = { userId:user.id, username:user.username, loggedInAt:new Date().toISOString() };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  invoke("set_session", { session: { access_token:randomId(), user_id:user.id, company_id:"local", company_name:"NATRA Management", role:"local-user", expires_at:"2099-12-31T23:59:59Z" }}).catch(() => {});
}
async function clearSession() { const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); localStorage.removeItem(SESSION_KEY); if (session?.userId) await invoke("clear_session", { userId:session.userId }).catch(() => {}); }

function renderCreate() {
  authShell(`<div class="auth-card"><div class="auth-brand"><img src="${logoUrl}" alt="NATRA"><h1>Create your NATRA account</h1><p>Set up your secure offline account</p><span class="auth-badge">LOCAL ACCOUNT</span></div><form id="natra-create-form"><label>Username</label><input id="natra-new-user" autocomplete="username" minlength="3" maxlength="40" required><label>Password</label>${passwordField("natra-new-pass","new-password")}<label>Confirm password</label>${passwordField("natra-new-confirm","new-password")}<div id="natra-auth-error" class="auth-error"></div><button id="natra-create-btn">Create Account</button></form><div class="auth-note">Your account is stored locally on this Windows PC. No internet connection is required.</div><div class="auth-footer">Powered by NATRA Technology · Addis Ababa ©2026</div></div>`);
  const screen = document.getElementById("natra-auth-screen");
  screen.querySelector("#natra-create-form").addEventListener("submit", async event => {
    event.preventDefault(); const btn=screen.querySelector("#natra-create-btn"), error=screen.querySelector("#natra-auth-error"); const username=screen.querySelector("#natra-new-user").value.trim(), password=screen.querySelector("#natra-new-pass").value, confirm=screen.querySelector("#natra-new-confirm").value;
    if(username.length<3)return error.textContent="Username must be at least 3 characters."; if(password.length<8)return error.textContent="Password must be at least 8 characters."; if(password!==confirm)return error.textContent="Passwords do not match."; if(getUsers().some(u=>u.username.toLowerCase()===username.toLowerCase()))return error.textContent="That username already exists.";
    btn.disabled=true; error.textContent="Creating account…";
    try { const salt=crypto.getRandomValues(new Uint8Array(16)); const user={id:randomId(),username,salt:bytesToBase64(salt),passwordHash:await passwordHash(password,salt),createdAt:new Date().toISOString()}; saveUsers([...getUsers(),user]); setSession(user); finish(user); } catch(e){btn.disabled=false;error.textContent=`Could not create account: ${e}`;}
  });
}

function renderLogin() {
  const users=getUsers();
  authShell(`<div class="auth-card"><div class="auth-brand"><img src="${logoUrl}" alt="NATRA"><h1>Welcome back</h1><p>Sign in to NATRA Management</p><span class="auth-badge">OFFLINE • LOCAL ACCESS</span></div><form id="natra-login-form"><label>Username</label><input id="natra-login-user" autocomplete="username" required><label>Password</label>${passwordField("natra-login-pass","current-password")}<div id="natra-auth-error" class="auth-error"></div><button id="natra-login-btn">Sign In to NATRA</button></form><button id="natra-create-another" class="secondary">Create another account</button><div class="auth-note">${users.length} local account${users.length===1?"":"s"} available on this PC.</div><div class="auth-footer">Powered by NATRA Technology · Addis Ababa ©2026</div></div>`);
  const screen=document.getElementById("natra-auth-screen");
  screen.querySelector("#natra-login-form").addEventListener("submit", async event=>{
    event.preventDefault(); const btn=screen.querySelector("#natra-login-btn"), error=screen.querySelector("#natra-auth-error"), username=screen.querySelector("#natra-login-user").value.trim(), password=screen.querySelector("#natra-login-pass").value, user=getUsers().find(u=>u.username.toLowerCase()===username.toLowerCase());
    if(!user)return error.textContent="Incorrect username or password."; btn.disabled=true; error.textContent="Checking…";
    try { if(!(await passwordsMatch(password,user.salt,user.passwordHash))){btn.disabled=false;error.textContent="Incorrect username or password.";return;} setSession(user); finish(user); } catch(e){btn.disabled=false;error.textContent=`Sign in failed: ${e}`;}
  });
  screen.querySelector("#natra-create-another").addEventListener("click",renderCreate);
}

function finish(user) { window.NATRA_AUTH={userId:user.id,username:user.username,logout:async()=>{await clearSession();location.reload();}}; document.getElementById("natra-auth-screen")?.remove(); updateUserMenu(user); }
function updateUserMenu(user) { const menu=document.querySelector(".user-menu"); if(!menu)return setTimeout(()=>updateUserMenu(user),50); const avatar=menu.querySelector(".avatar"),text=menu.querySelector("div:nth-child(2)"); if(avatar)avatar.textContent=user.username.slice(0,1).toUpperCase(); if(text)text.innerHTML=`<b>${esc(user.username)}</b><small>Offline account</small>`; menu.title="Click to sign out"; menu.style.cursor="pointer"; menu.onclick=async()=>{if(confirm(`Sign out ${user.username}?`))await window.NATRA_AUTH.logout();}; }

async function authenticate() { ensureStyle(); const screen=document.createElement("div"); screen.id="natra-auth-screen"; document.body.appendChild(screen); const users=getUsers(); if(!users.length)renderCreate();else renderLogin(); await new Promise(resolve=>{const timer=setInterval(()=>{if(!document.getElementById("natra-auth-screen")){clearInterval(timer);resolve();}},50);}); }

authenticate();
