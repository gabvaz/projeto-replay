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

/* ------------------------------------------------------- portal da arena */

const ARENA_COOKIE = "rs_arena";
const ARENA_TTL_SEC = 30 * 24 * 60 * 60;

async function arenaKey(env: Bindings): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`arena|${env.SESSION_SECRET}`));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function arenaSign(env: Bindings, value: string): Promise<string> {
  return toHex(await crypto.subtle.sign("HMAC", await arenaKey(env), new TextEncoder().encode(value)));
}

/**
 * Troca o token do link por sessão. Lax: o link chega por WhatsApp (navegação cross-site);
 * as mutações continuam protegidas pela exigência de JSON.
 */
export async function startArenaSession(c: Context<Env>, linkId: string): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + ARENA_TTL_SEC;
  const value = `${linkId}.${exp}`;
  setCookie(c, ARENA_COOKIE, `${value}.${await arenaSign(c.env, value)}`, {
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

/** Cookie válido + link ainda ativo (revogar derruba a sessão na hora). */
export const arenaAuth: MiddlewareHandler<Env> = async (c, next) => {
  const [linkId, expStr, sig] = getCookie(c, ARENA_COOKIE)?.split(".") ?? [];
  const exp = Number(expStr);
  if (!sig || !c.env.SESSION_SECRET || !Number.isFinite(exp) || exp * 1000 < Date.now()) {
    return c.json({ error: "unauthorized" }, 401);
  }
  if (!safeEqual(sig, await arenaSign(c.env, `${linkId}.${expStr}`))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const link = await c.env.DB.prepare(
    "SELECT venue_id FROM venue_access_links WHERE id = ? AND revoked_at IS NULL",
  )
    .bind(linkId)
    .first<{ venue_id: string }>();
  if (!link) {
    endArenaSession(c);
    return c.json({ error: "unauthorized" }, 401);
  }

  const mutating = !["GET", "HEAD", "OPTIONS"].includes(c.req.method);
  const ct = c.req.header("content-type") ?? "";
  if (mutating && !ct.includes("application/json") && c.req.header("x-requested-with") !== "replay") {
    return c.json({ error: "json_required" }, 415);
  }
  c.set("venueId", link.venue_id);
  await next();
};
