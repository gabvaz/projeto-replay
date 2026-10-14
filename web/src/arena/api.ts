import type { Brand } from "../shared/brand";
import type { DayPoint, HeatCell } from "../shared/charts";

export class UnauthorizedError extends Error {}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Cookie de sessão vai sozinho; mutação sempre JSON (o Worker exige, anti-CSRF). */
export async function portalFetch<T>(path: string, method: Method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`/portal${path}`, {
    method,
    credentials: "same-origin",
    headers: method === "GET" ? undefined : { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  return parse<T>(res);
}

/** Upload de arquivo cru (logo). O header custom faz o papel do JSON contra CSRF. */
export async function portalUpload<T>(path: string, file: File): Promise<T> {
  const res = await fetch(`/portal${path}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": file.type, "x-requested-with": "replay" },
    body: file,
  });
  return parse<T>(res);
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new UnauthorizedError();
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `http_${res.status}`);
  return data;
}

export const get = <T>(path: string) => portalFetch<T>(path);

export type Me = {
  venue: { id: string; name: string; city: string | null; public_name: string | null; brand_color: string | null };
  brand: Brand;
  brand_colors: string[];
  contract: { monthly_cents: number; due_day: number; start_date: string } | null;
  overdue: { n: number; cents: number };
  support_whatsapp: string | null;
  today: string;
};

export type CourtStat = {
  id: string;
  name: string;
  public_key: string;
  clips: number;
  views: number;
  downloads: number;
  shares: number;
};

export type ArenaOverview = {
  days: number;
  today: string;
  totals: Record<string, number>;
  unique_daily_visitors: number;
  series: DayPoint[];
  courts: CourtStat[];
  heatmap: HeatCell[];
};

export type Court = {
  id: string;
  name: string;
  public_key: string;
  clips_7d: number;
  clips_live: number;
  last_clip_at: string | null;
};

export type StatusData = {
  devices: { id: string; name: string; online: boolean; last_seen_at: string | null }[];
  courts: { id: string; name: string; last_clip_at: string | null; clips_7d: number }[];
};

export type ArenaClip = {
  id: string;
  status: string;
  bytes: number | null;
  court_id: string;
  court_name: string;
  time_local: string;
  views: number;
  downloads: number;
  thumb_url: string | null;
};

export type ArenaInvoice = {
  id: string;
  period: string;
  amount_cents: number;
  due_date: string;
  status: "open" | "paid" | "void";
  paid_at: string | null;
  overdue: boolean;
};

export const ERROR_LABEL: Record<string, string> = {
  invalid_logo_type: "Use PNG, JPG ou WEBP",
  logo_too_large: "Imagem maior que 300 KB",
  invalid_brand_color: "Cor inválida",
  clip_not_found: "Clip não encontrado",
};

export const errorText = (err: unknown) =>
  err instanceof ApiError ? (ERROR_LABEL[err.code] ?? err.code) : "Erro inesperado";
