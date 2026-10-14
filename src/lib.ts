export type Bindings = {
  DB: D1Database;
  CLIPS: R2Bucket;
  ASSETS: Fetcher;
  ADMIN_TOKEN: string;
  SESSION_SECRET: string;
  IP_HASH_SALT?: string;
  RETENTION_DAYS?: string;
  DEVICE_OFFLINE_SEC?: string;
  SUPPORT_WHATSAPP?: string;
  /** URL pública (links nos e-mails). */
  APP_URL?: string;
  /** Opcional até o domínio estar no Email Routing; sem ele o alerta só vai pro log. */
  EMAIL?: SendEmail;
  ALERT_EMAIL_FROM?: string;
  /** Vírgula separa vários; precisam ser destinos verificados no Email Routing. */
  ALERT_EMAIL_TO?: string;
};

export type Device = {
  id: string;
  venue_id: string;
  name: string;
};

export type Env = {
  Bindings: Bindings;
  Variables: { device: Device; sessionExp: number; venueId: string };
};

/** Brasil sem horário de verão desde 2019: UTC-3 fixo. */
export const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

const encoder = new TextEncoder();

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export function safeEqual(a: string, b: string): boolean {
  const ea = encoder.encode(a);
  const eb = encoder.encode(b);
  return ea.byteLength === eb.byteLength && crypto.subtle.timingSafeEqual(ea, eb);
}

export function bearer(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function retentionDays(env: Bindings): number {
  const n = Number(env.RETENTION_DAYS ?? 7);
  return Number.isFinite(n) && n > 0 ? n : 7;
}

export function deviceOfflineSec(env: Bindings): number {
  const n = Number(env.DEVICE_OFFLINE_SEC ?? 180);
  return Number.isFinite(n) && n > 0 ? n : 180;
}

export function todayBrt(): string {
  return new Date(Date.now() - BRT_OFFSET_MS).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" (BRT) → "YYYY-MM-DD HH:MM:SS" em UTC, pra comparar com created_at. */
export function brtDayStartUtc(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return new Date(d.getTime() + BRT_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
}

/** Date → "YYYY-MM-DD HH:MM:SS" (UTC), o formato do datetime('now') do D1. */
export function sqlTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/** Horário vindo do Pi: aceita só ISO válido dentro de [agora - maxAgeMs, agora + 1 min]. */
export function pastTime(v: unknown, maxAgeMs: number): string | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t) || t < Date.now() - maxAgeMs || t > Date.now() + 60_000) return null;
  return sqlTime(new Date(Math.min(t, Date.now())));
}

export function randomHex(bytes: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}
