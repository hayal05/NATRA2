import { SignJWT, jwtVerify } from "jose";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "./db.js";

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

export function hashPassword(password) {
  if (String(password).length < 10) throw new Error("Password must be at least 10 characters");
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, encoded) {
  const [scheme, salt, expected] = String(encoded).split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const target = Buffer.from(expected, "hex");
  return actual.length === target.length && timingSafeEqual(actual, target);
}

export async function signSession(user) {
  return new SignJWT({
    company_id: user.company_id,
    role: user.role,
    name: user.name,
    email: user.email
  }).setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret);
}

export async function requireAuth(c, next) {
  const header = c.req.header("Authorization") || "";
  if (!header.startsWith("Bearer ")) return c.json({error:"Unauthorized"},401);
  try {
    const { payload } = await jwtVerify(header.slice(7), secret);
    c.set("auth", payload);
    await next();
  } catch {
    return c.json({error:"Invalid or expired session"},401);
  }
}

export function authContext(c) {
  const a = c.get("auth");
  if (!a?.sub || !a?.company_id) throw new Error("Invalid auth context");
  return { userId: String(a.sub), companyId: String(a.company_id), role: String(a.role || "cashier") };
}
