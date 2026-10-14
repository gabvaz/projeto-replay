import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { bearer, safeEqual, sha256Hex, toHex, type Bindings, type Device, type Env } from "./lib";

const SESSION_COOKIE = "rs_admin";
const SESSION_TTL_SEC = 8 * 60 * 60;

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

/** Chave HMAC derivada do ADMIN_TOKEN: trocar o token derruba todas as sessões. */
async function sessionKey(env: Bindings): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`session|${env.ADMIN_TOKEN}`),
  );
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(env: Bindings, value: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await sessionKey(env), new TextEncoder().encode(value));
  return toHex(sig);
}

export async function checkAdminToken(env: Bindings, token: string): Promise<boolean> {
  if (!env.ADMIN_TOKEN) return false;
  const [a, b] = await Promise.all([sha256Hex(token), sha256Hex(env.ADMIN_TOKEN)]);
  return safeEqual(a, b);
}

export async function startSession(c: Context<Env>): Promise<number> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  setCookie(c, SESSION_COOKIE, `${exp}.${await sign(c.env, String(exp))}`, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
  return exp;
}

export function endSession(c: Context<Env>): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
}

async function sessionExp(c: Context<Env>): Promise<number | null> {
  const value = getCookie(c, SESSION_COOKIE);
  const [expStr, sig] = value?.split(".") ?? [];
  const exp = Number(expStr);
  if (!sig || !Number.isFinite(exp) || exp * 1000 < Date.now() || !c.env.ADMIN_TOKEN) return null;
  return safeEqual(sig, await sign(c.env, expStr)) ? exp : null;
}

/**
 * Bearer ADMIN_TOKEN (scripts) ou cookie de sessão (painel).
 * Mutação via cookie exige JSON: form cross-site não consegue mandar sem preflight.
 */
export const adminAuth: MiddlewareHandler<Env> = async (c, next) => {
  if (c.req.path === "/admin/session" && c.req.method === "POST") return next();

  const token = bearer(c.req.header("authorization"));
  if (token) {
    if (!(await checkAdminToken(c.env, token))) return c.json({ error: "unauthorized" }, 401);
    return next();
  }

  const exp = await sessionExp(c);
  if (!exp) return c.json({ error: "unauthorized" }, 401);
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(c.req.method);
  if (mutating && !c.req.header("content-type")?.includes("application/json")) {
    return c.json({ error: "json_required" }, 415);
  }
  c.set("sessionExp", exp);
  await next();
};
