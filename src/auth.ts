import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { bearer, randomHex, safeEqual, sha256Hex, toHex, type Bindings, type Device, type Env } from "./lib";

const ADMIN_COOKIE = "rs_admin";
const ARENA_COOKIE = "rs_arena";
const ADMIN_TTL_SEC = 8 * 60 * 60;
const ARENA_TTL_SEC = 30 * 24 * 60 * 60;
const PBKDF2_ITERS = 100_000;

export type Account = {
  id: string;
  email: string;
  password_hash: string;
  role: "admin" | "arena";
  venue_id: string | null;
  disabled_at: string | null;
};

const encoder = new TextEncoder();

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function deriveBits(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

/** Formato: pbkdf2$iters$saltHex$hashHex */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveBits(password, salt, PBKDF2_ITERS);
  return `pbkdf2$${PBKDF2_ITERS}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iterStr, saltHex, hashHex] = stored.split("$");
  const iterations = Number(iterStr);
  if (algo !== "pbkdf2" || !saltHex || !hashHex || !Number.isFinite(iterations)) return false;
  const derived = toHex(await deriveBits(password, fromHex(saltHex), iterations));
  return safeEqual(derived, hashHex);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmail(v: unknown): v is string {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/** Senha temporária legível (ex.: a3f9-c2b1-88de). */
export function generatePassword(): string {
  const hex = randomHex(6);
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export async function findAccountByEmail(db: D1Database, email: string): Promise<Account | null> {
  return (
    (await db
      .prepare(
        `SELECT id, email, password_hash, role, venue_id, disabled_at
         FROM accounts WHERE email = ? COLLATE NOCASE`,
      )
      .bind(normalizeEmail(email))
      .first<Account>()) ?? null
  );
}

export async function findAccountById(db: D1Database, id: string): Promise<Account | null> {
  return (
    (await db
      .prepare(
        `SELECT id, email, password_hash, role, venue_id, disabled_at
         FROM accounts WHERE id = ?`,
      )
      .bind(id)
      .first<Account>()) ?? null
  );
}

/** Cria o primeiro admin se a tabela estiver vazia e BOOTSTRAP_ADMIN_PASSWORD existir. */
export async function ensureBootstrapAdmin(env: Bindings): Promise<void> {
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!password) return;
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts WHERE role = 'admin'").first<{ n: number }>();
  if (Number(row?.n ?? 0) > 0) return;
  const email = normalizeEmail(env.BOOTSTRAP_ADMIN_EMAIL || "admin@loop.local");
  await env.DB.prepare(
    `INSERT INTO accounts (id, email, password_hash, role) VALUES (?, ?, ?, 'admin')`,
  )
    .bind(`acc_${randomHex(6)}`, email, await hashPassword(password))
    .run();
}

/* ---------------------------------------------------------------- edge Pi */

/** Pi autenticado por token próprio; só o hash fica no D1. */
export const edgeAuth: MiddlewareHandler<Env> = async (c, next) => {
  const token = bearer(c.req.header("authorization"));
  if (!token) return c.json({ error: "unauthorized" }, 401);

  const device = await c.env.DB.prepare(
    "SELECT id, venue_id, name FROM devices WHERE token_hash = ? AND revoked_at IS NULL",
  )
    .bind(await sha256Hex(token))
    .first<Device>();

  if (!device) return c.json({ error: "unauthorized" }, 401);
  c.set("device", device);
  await next();
};

/* -------------------------------------------------------------- sessões */

async function hmacKey(env: Bindings, scope: "admin" | "arena"): Promise<CryptoKey> {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET missing");
  const raw = await crypto.subtle.digest("SHA-256", encoder.encode(`${scope}|${env.SESSION_SECRET}`));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(env: Bindings, scope: "admin" | "arena", value: string): Promise<string> {
  return toHex(await crypto.subtle.sign("HMAC", await hmacKey(env, scope), encoder.encode(value)));
}

function parseCookie(value: string | undefined): { id: string; exp: number; sig: string } | null {
  const [id, expStr, sig] = value?.split(".") ?? [];
  const exp = Number(expStr);
  if (!id || !sig || !Number.isFinite(exp)) return null;
  return { id, exp, sig };
}

export async function startAdminSession(c: Context<Env>, accountId: string): Promise<number> {
  const exp = Math.floor(Date.now() / 1000) + ADMIN_TTL_SEC;
  const payload = `${accountId}.${exp}`;
  setCookie(c, ADMIN_COOKIE, `${payload}.${await sign(c.env, "admin", payload)}`, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: ADMIN_TTL_SEC,
  });
  return exp;
}

export function endAdminSession(c: Context<Env>): void {
  deleteCookie(c, ADMIN_COOKIE, { path: "/", secure: true });
}

export async function startArenaSession(c: Context<Env>, accountId: string): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + ARENA_TTL_SEC;
  const payload = `${accountId}.${exp}`;
  setCookie(c, ARENA_COOKIE, `${payload}.${await sign(c.env, "arena", payload)}`, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: ARENA_TTL_SEC,
  });
}

export function endArenaSession(c: Context<Env>): void {
  deleteCookie(c, ARENA_COOKIE, { path: "/", secure: true });
}

/** Bearer ADMIN_TOKEN (scripts legados) ou cookie de conta admin. */
export const adminAuth: MiddlewareHandler<Env> = async (c, next) => {
  if (c.req.path === "/admin/session" && c.req.method === "POST") return next();

  const token = bearer(c.req.header("authorization"));
  if (token) {
    if (!c.env.ADMIN_TOKEN) return c.json({ error: "unauthorized" }, 401);
    const [a, b] = await Promise.all([sha256Hex(token), sha256Hex(c.env.ADMIN_TOKEN)]);
    if (!safeEqual(a, b)) return c.json({ error: "unauthorized" }, 401);
    return next();
  }

  if (!c.env.SESSION_SECRET) return c.json({ error: "unauthorized" }, 401);
  const parsed = parseCookie(getCookie(c, ADMIN_COOKIE));
  if (!parsed || parsed.exp * 1000 < Date.now()) return c.json({ error: "unauthorized" }, 401);
  if (!safeEqual(parsed.sig, await sign(c.env, "admin", `${parsed.id}.${parsed.exp}`))) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const account = await findAccountById(c.env.DB, parsed.id);
  if (!account || account.role !== "admin" || account.disabled_at) {
    endAdminSession(c);
    return c.json({ error: "unauthorized" }, 401);
  }

  const mutating = !["GET", "HEAD", "OPTIONS"].includes(c.req.method);
  if (mutating && !c.req.header("content-type")?.includes("application/json")) {
    return c.json({ error: "json_required" }, 415);
  }
  c.set("sessionExp", parsed.exp);
  c.set("accountId", account.id);
  c.set("accountEmail", account.email);
  await next();
};

export const arenaAuth: MiddlewareHandler<Env> = async (c, next) => {
  if (c.req.path === "/portal/session" && c.req.method === "POST") return next();

  if (!c.env.SESSION_SECRET) return c.json({ error: "unauthorized" }, 401);
  const parsed = parseCookie(getCookie(c, ARENA_COOKIE));
  if (!parsed || parsed.exp * 1000 < Date.now()) return c.json({ error: "unauthorized" }, 401);
  if (!safeEqual(parsed.sig, await sign(c.env, "arena", `${parsed.id}.${parsed.exp}`))) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const account = await findAccountById(c.env.DB, parsed.id);
  if (!account || account.role !== "arena" || !account.venue_id || account.disabled_at) {
    endArenaSession(c);
    return c.json({ error: "unauthorized" }, 401);
  }

  const mutating = !["GET", "HEAD", "OPTIONS"].includes(c.req.method);
  const ct = c.req.header("content-type") ?? "";
  if (mutating && !ct.includes("application/json") && c.req.header("x-requested-with") !== "replay") {
    return c.json({ error: "json_required" }, 415);
  }
  c.set("venueId", account.venue_id);
  c.set("accountId", account.id);
  c.set("accountEmail", account.email);
  await next();
};
