import { invoke } from "@tauri-apps/api/core";

const USERS_KEY = "natra.offline.users.v1";
const SESSION_KEY = "natra.offline.session.v1";
const ITERATIONS = 150000;

const esc = (s) => String(s ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#039;"}[c]));
const bytesToBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const base64ToBytes = (value) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const randomId = () => crypto.randomUUID();

function getUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY) || "[]"); }
  catch (_) { return []; }
}
function saveUsers(users) { localStorage.setItem(USERS_KEY, JSON.stringify(users)); }

async function derivePassword(password, saltBytes) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({name:"PBKDF2", salt:saltBytes, iterations:ITERATIONS, hash:"SHA-256"}, key, 256);
  return new Uint8Array(bits);
}

async function passwordHash(password, saltBytes) {
  return bytesToBase64(await derivePassword(password, saltBytes));
}

async function passwordsMatch(password, salt, expected) {
  const actual = await derivePassword(password, base64ToBytes(salt));
  const wanted = base64ToBytes(expected);
  if (actual.length !== wanted.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ wanted[i];
  return diff === 0;
}

function ensureStyle() {
  if (document.getElementById("natra-auth-style")) return;
  const style = document.createElement("style");
  style.id = "natra-auth-style";
  style.textContent = `
    #natra-auth-screen{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:linear-gradient(135deg,#07111f,#123b63);font-family:Arial,sans-serif;padding:20px;box-sizing:border-box}
    #natra-auth-screen .auth-card{width:390px;max-width:100%;background:#fff;border-radius:20px;padding:32px;box-sizing:border-box;box-shadow:0 25px 80px rgba(0,0,0,.35)}
    #natra-auth-screen .auth-brand{text-align:center;margin-bottom:24px}
    #natra-auth-screen .auth-brand h1{margin:0;font-size:30px;letter-spacing:.5px;font-weight:800}
    #natra-auth-screen .auth-brand p{margin:7px 0 0;color:#667085;font-size:14px}
    #natra-auth-screen .auth-badge{display:inline-block;margin-top:10px;padding:5px 10px;border-radius:999px;background:#ecfdf3;color:#027a48;font-size:12px;font-weight:700}
    #natra-auth-screen label{display:block;margin:14px 0 6px;font-size:13px;font-weight:700;color:#344054}
    #natra-auth-screen input{width:100%;box-sizing:border-box;padding:12px 13px;border:1px solid #d0d5dd;border-radius:10px;outline:none;font-size:14px}
    #natra-auth-screen input:focus{border-color:#1570ef;box-shadow:0 0 0 3px rgba(21,112,239,.12)}
    #natra-auth-screen button{width:100%;border:0;border-radius:10px;padding:12px;margin-top:16px;background:#178a45;color:#fff;font-weight:800;font-size:14px;cursor:pointer}
    #natra-auth-screen button.secondary{background:#eef2f6;color:#344054}
    #natra-auth-screen button:disabled{opacity:.6;cursor:wait}
    #natra-auth-screen .auth-error{min-height:20px;margin-top:12px;color:#b42318;font-size:13px;text-align:center}
    #natra-auth-screen .auth-note{margin-top:18px;text-align:center;color:#667085;font-size:12px;line-height:1.5}
    #natra-auth-screen .auth-switch{margin-top:10px}
  `;
  document.head.appendChild(style);
}

function setSession(user) {
  const session = { userId:user.id, username:user.username, loggedInAt:new Date().toISOString() };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  invoke("set_session", { session: {
    access_token: randomId(), user_id:user.id, company_id:"local", company_name:"NATRA Management", role:"local-user", expires_at:"2099-12-31T23:59:59Z"
  }}).catch(() => {});
}

async function clearSession() {
  const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  localStorage.removeItem(SESSION_KEY);
  if (session?.userId) await invoke("clear_session", { userId:session.userId }).catch(() => {});
}

function renderCreate() {
  const screen = document.getElementById("natra-auth-screen");
  screen.innerHTML = `<div class="auth-card"><div class="auth-brand"><h1>NATRA Management</h1><p>Offline account setup</p><span class="auth-badge">LOCAL • WORKS OFFLINE</span></div><form id="natra-create-form"><label>Username</label><input id="natra-new-user" autocomplete="username" minlength="3" maxlength="40" required><label>Password</label><input id="natra-new-pass" type="password" autocomplete="new-password" minlength="8" required><label>Confirm password</label><input id="natra-new-confirm" type="password" autocomplete="new-password" minlength="8" required><div id="natra-auth-error" class="auth-error"></div><button id="natra-create-btn">Create Account</button></form><div class="auth-note">Your account is stored locally on this Windows PC. No internet connection is required.</div></div>`;
  screen.querySelector("#natra-create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const btn = screen.querySelector("#natra-create-btn");
    const error = screen.querySelector("#natra-auth-error");
    const username = screen.querySelector("#natra-new-user").value.trim();
    const password = screen.querySelector("#natra-new-pass").value;
    const confirm = screen.querySelector("#natra-new-confirm").value;
    if (username.length < 3) return error.textContent = "Username must be at least 3 characters.";
    if (password.length < 8) return error.textContent = "Password must be at least 8 characters.";
    if (password !== confirm) return error.textContent = "Passwords do not match.";
    if (getUsers().some(u => u.username.toLowerCase() === username.toLowerCase())) return error.textContent = "That username already exists.";
    btn.disabled = true; error.textContent = "Creating account…";
    try {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const user = {id:randomId(), username, salt:bytesToBase64(salt), passwordHash:await passwordHash(password,salt), createdAt:new Date().toISOString()};
      saveUsers([...getUsers(), user]);
      setSession(user);
      finish(user);
    } catch (e) { btn.disabled=false; error.textContent=`Could not create account: ${e}`; }
  });
}

function renderLogin() {
  const screen = document.getElementById("natra-auth-screen");
  const users = getUsers();
  screen.innerHTML = `<div class="auth-card"><div class="auth-brand"><h1>NATRA Management</h1><p>Sign in to your offline account</p><span class="auth-badge">LOCAL • OFFLINE</span></div><form id="natra-login-form"><label>Username</label><input id="natra-login-user" autocomplete="username" required><label>Password</label><input id="natra-login-pass" type="password" autocomplete="current-password" required><div id="natra-auth-error" class="auth-error"></div><button id="natra-login-btn">Sign In</button></form><button id="natra-create-another" class="secondary">Create another account</button><div class="auth-note">${users.length} local account${users.length===1?"":"s"} available on this PC.</div></div>`;
  screen.querySelector("#natra-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const btn = screen.querySelector("#natra-login-btn");
    const error = screen.querySelector("#natra-auth-error");
    const username = screen.querySelector("#natra-login-user").value.trim();
    const password = screen.querySelector("#natra-login-pass").value;
    const user = getUsers().find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) return error.textContent = "Incorrect username or password.";
    btn.disabled = true; error.textContent = "Checking…";
    try {
      if (!(await passwordsMatch(password,user.salt,user.passwordHash))) { btn.disabled=false; error.textContent="Incorrect username or password."; return; }
      setSession(user); finish(user);
    } catch (e) { btn.disabled=false; error.textContent=`Sign in failed: ${e}`; }
  });
  screen.querySelector("#natra-create-another").addEventListener("click", renderCreate);
}

function finish(user) {
  window.NATRA_AUTH = { userId:user.id, username:user.username, logout:async()=>{await clearSession(); location.reload();} };
  document.getElementById("natra-auth-screen")?.remove();
  updateUserMenu(user);
}

function updateUserMenu(user) {
  const menu = document.querySelector(".user-menu");
  if (!menu) return setTimeout(() => updateUserMenu(user), 50);
  const avatar = menu.querySelector(".avatar");
  const text = menu.querySelector("div:nth-child(2)");
  if (avatar) avatar.textContent = user.username.slice(0,1).toUpperCase();
  if (text) text.innerHTML = `<b>${esc(user.username)}</b><small>Offline account</small>`;
  menu.title = "Click to sign out";
  menu.style.cursor = "pointer";
  menu.onclick = async () => { if (confirm(`Sign out ${user.username}?`)) await window.NATRA_AUTH.logout(); };
}

async function authenticate() {
  ensureStyle();
  const screen = document.createElement("div"); screen.id = "natra-auth-screen"; document.body.appendChild(screen);
  const users = getUsers();
  if (!users.length) renderCreate(); else renderLogin();
  await new Promise(resolve => {
    const done = () => resolve();
    const timer = setInterval(() => { if (!document.getElementById("natra-auth-screen")) { clearInterval(timer); done(); } }, 50);
  });
}

await authenticate();
