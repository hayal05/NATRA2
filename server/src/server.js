import "node:process";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { db } from "./db.js";
import { authContext, hashPassword, requireAuth, signSession, verifyPassword } from "./auth.js";
import { randomUUID } from "node:crypto";

const app = new Hono();

const allowedOrigins = new Set(
  String(process.env.CORS_ORIGIN || "")
    .split(",")
    .map(v => v.trim())
    .filter(Boolean)
);

if (process.env.NODE_ENV === "production" && allowedOrigins.size === 0) {
  throw new Error("CORS_ORIGIN must be configured in production");
}

app.use("*", cors({
  origin: (origin) => {
    if (!origin) return "";
    if (allowedOrigins.size === 0) return origin;
    return allowedOrigins.has(origin) ? origin : "";
  },
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET","POST","OPTIONS"],
  maxAge: 86400
}));

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cache-Control", "no-store");
});

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function loginRateLimited(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.startedAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, {startedAt: now, count: 1});
    return false;
  }
  entry.count += 1;
  return entry.count > LOGIN_MAX_ATTEMPTS;
}

app.get("/health", (c) => c.json({ok:true, service:"smart-inventory-sync-api", version:"1.0.0"}));

app.post("/v1/auth/login", async (c) => {
  const body = await c.req.json();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
  const rateKey = `${ip}:${email}`;
  if (loginRateLimited(rateKey)) return c.json({error:"Too many login attempts. Try again later."},429);
  if (!email || !password) return c.json({error:"Email and password are required"},400);

  const result = await db.execute({
    sql: `SELECT u.id,u.company_id,u.email,u.password_hash,u.name,u.role,c.name AS company_name
          FROM users u JOIN companies c ON c.id=u.company_id
          WHERE lower(u.email)=? AND u.active=1 AND c.active=1 LIMIT 1`,
    args: [email]
  });
  const user = result.rows[0];
  if (!user || !verifyPassword(password, String(user.password_hash))) {
    return c.json({error:"Invalid credentials"},401);
  }

  const access_token = await signSession(user);
  return c.json({
    access_token,
    user_id: String(user.id),
    company_id: String(user.company_id),
    company_name: String(user.company_name),
    role: String(user.role),
    expires_in: 43200
  });
});

app.get("/v1/me", requireAuth, async (c) => {
  const { userId, companyId } = authContext(c);
  const result = await db.execute({
    sql: `SELECT u.id,u.email,u.name,u.role,c.id AS company_id,c.name AS company_name
          FROM users u JOIN companies c ON c.id=u.company_id
          WHERE u.id=? AND u.company_id=? LIMIT 1`,
    args: [userId, companyId]
  });
  if (!result.rows[0]) return c.json({error:"User not found"},404);
  return c.json(result.rows[0]);
});

app.post("/v1/sync/push", requireAuth, async (c) => {
  const { userId, companyId } = authContext(c);
  const body = await c.req.json();
  const deviceId = String(body.device_id || "");
  const events = Array.isArray(body.events) ? body.events : [];
  if (!deviceId || events.length > 500) return c.json({error:"Invalid sync batch"},400);

  for (const e of events) {
    const entityType = String(e.entity_type || "");
    const entityId = String(e.entity_id || "");
    const operation = String(e.operation || "");
    const version = Number(e.version || 1);
    if (!entityType || !entityId || !["UPSERT","DELETE"].includes(operation)) continue;

    await db.execute({
      sql: `INSERT INTO tenant_records(company_id,entity_type,entity_id,version,deleted,payload,updated_at)
            VALUES(?,?,?,?,?,?,datetime('now'))
            ON CONFLICT(company_id,entity_type,entity_id)
            DO UPDATE SET version=excluded.version,deleted=excluded.deleted,payload=excluded.payload,updated_at=excluded.updated_at
            WHERE excluded.version >= tenant_records.version`,
      args: [companyId, entityType, entityId, version, operation === "DELETE" ? 1 : 0, e.payload ? JSON.stringify(e.payload) : null]
    });

    await db.execute({
      sql: `INSERT INTO sync_events(company_id,device_id,entity_type,entity_id,operation,version,payload,created_at)
            VALUES(?,?,?,?,?,?,?,datetime('now'))`,
      args: [companyId, deviceId, entityType, entityId, operation, version, e.payload ? JSON.stringify(e.payload) : null]
    });

    await db.execute({
      sql: `INSERT INTO audit_events(company_id,user_id,action,entity_type,entity_id,details,created_at)
            VALUES(?,?,?,?,?,?,datetime('now'))`,
      args: [companyId, userId, "SYNC_PUSH", entityType, entityId, operation]
    });
  }
  return c.json({ok:true, accepted:events.length});
});

app.get("/v1/sync/pull", requireAuth, async (c) => {
  const { companyId } = authContext(c);
  const after = Number(c.req.query("after") || 0);
  const result = await db.execute({
    sql: `SELECT sequence,entity_type,entity_id,operation,version,payload,created_at
          FROM sync_events WHERE company_id=? AND sequence>? ORDER BY sequence ASC LIMIT 500`,
    args: [companyId, after]
  });
  return c.json({
    events: result.rows.map(r => ({
      sequence: Number(r.sequence),
      entity_type: String(r.entity_type),
      entity_id: String(r.entity_id),
      operation: String(r.operation),
      version: Number(r.version),
      payload: r.payload ? JSON.parse(String(r.payload)) : null,
      created_at: String(r.created_at)
    }))
  });
});

app.post("/v1/devices/register", requireAuth, async (c) => {
  const { userId, companyId } = authContext(c);
  const body = await c.req.json();
  const id = String(body.device_id || randomUUID());
  const name = String(body.name || "Windows Desktop");
  await db.execute({
    sql: `INSERT INTO devices(id,company_id,user_id,name,last_seen_at)
          VALUES(?,?,?,?,datetime('now'))
          ON CONFLICT(id) DO UPDATE SET last_seen_at=datetime('now'),active=1`,
    args: [id, companyId, userId, name]
  });
  return c.json({device_id:id});
});

app.post("/v1/auth/hash-password", async (c) => {
  // Development/admin provisioning helper. Disable this route in production.
  if (process.env.NODE_ENV === "production") return c.json({error:"Disabled"},404);
  const body = await c.req.json();
  return c.json({hash: hashPassword(String(body.password || ""))});
});

if (process.env.NODE_ENV === "production" && String(process.env.JWT_SECRET || "").length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters in production");
}
if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required");
}

serve({ fetch: app.fetch, port: Number(process.env.PORT || 8787) });
