import { invoke } from "@tauri-apps/api/core";

const API_BASE = localStorage.getItem("smartInventoryApiBase") || "https://api.example.com";

export async function login(email, password) {
  const r = await fetch(`${API_BASE}/v1/auth/login`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({email, password})
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Login failed");
  await invoke("set_session", {session: {
    access_token:data.access_token,
    user_id:data.user_id,
    company_id:data.company_id,
    company_name:data.company_name,
    role:data.role,
    expires_at:String(Date.now()+data.expires_in*1000)
  }});
  localStorage.setItem("smartInventorySession", JSON.stringify(data));
  return data;
}

export function session() {
  try { return JSON.parse(localStorage.getItem("smartInventorySession") || "null"); }
  catch { return null; }
}

export async function logout() {
  const s = session();
  if (s?.user_id) await invoke("clear_session", {userId:s.user_id});
  localStorage.removeItem("smartInventorySession");
}

export async function registerDevice(name="Windows Desktop") {
  const s = session();
  if (!s) throw new Error("Not authenticated");
  const r = await fetch(`${API_BASE}/v1/devices/register`, {
    method:"POST",
    headers:{Authorization:`Bearer ${s.access_token}`,"Content-Type":"application/json"},
    body:JSON.stringify({name})
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Device registration failed");
  localStorage.setItem("smartInventoryDeviceId", data.device_id);
  return data.device_id;
}

export async function pushEvents(events) {
  const s=session();
  if (!s) throw new Error("Not authenticated");
  const device_id=localStorage.getItem("smartInventoryDeviceId") || await registerDevice();
  const r=await fetch(`${API_BASE}/v1/sync/push`,{
    method:"POST",
    headers:{Authorization:`Bearer ${s.access_token}`,"Content-Type":"application/json"},
    body:JSON.stringify({device_id,events})
  });
  const data=await r.json();
  if(!r.ok) throw new Error(data.error || "Sync push failed");
  return data;
}

export async function pullEvents(after=0) {
  const s=session();
  if (!s) throw new Error("Not authenticated");
  const r=await fetch(`${API_BASE}/v1/sync/pull?after=${encodeURIComponent(after)}`,{
    headers:{Authorization:`Bearer ${s.access_token}`}
  });
  const data=await r.json();
  if(!r.ok) throw new Error(data.error || "Sync pull failed");
  return data.events || [];
}

export { API_BASE };
