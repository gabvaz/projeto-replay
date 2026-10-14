export class UnauthorizedError extends Error {}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Cookie de sessão vai sozinho; mutação sempre JSON (o Worker exige, anti-CSRF). */
export async function adminFetch<T>(path: string, method: Method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`/admin${path}`, {
    method,
    credentials: "same-origin",
    headers: method === "GET" ? undefined : { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  if (res.status === 401) throw new UnauthorizedError();
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `http_${res.status}`);
  return data;
}

export const get = <T>(path: string) => adminFetch<T>(path);

/* ------------------------------------------------------------------ tipos */

export type DayPoint = { day: string; clips: number; views: number; downloads: number; shares: number };

export type Alert =
  | { kind: "device_offline"; severity: string; venue_id: string; venue_name: string; device: string; since: string | null }
  | { kind: "device_health"; severity: string; venue_id: string; venue_name: string; device: string; detail: string }
  | { kind: "invoice_overdue"; severity: string; venue_id: string; venue_name: string; period: string; amount_cents: number; due_date: string };

export type Overview = {
  today: string;
  venues: Record<string, number>;
  devices: { total: number; online: number };
  clips: { today: number; d7: number; d30: number };
  engagement30: { views: number; downloads: number; shares: number; unique_daily_visitors: number };
  series: DayPoint[];
  finance: {
    mrr_cents: number;
    contracts: number;
    open_cents: number;
    overdue_cents: number;
    overdue_count: number;
    paid_month_cents: number;
    due_month_cents: number;
  };
  alerts: Alert[];
  top_venues: { venue_id: string; venue_name: string; clips: number; views: number; downloads: number; shares: number }[];
};

export type VenueStatus = "onboarding" | "active" | "paused" | "churned";

export type VenueRow = {
  id: string;
  name: string;
  city: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  status: VenueStatus;
  notes: string | null;
  created_at: string;
  courts: number;
  devices: number;
  devices_online: number;
  clips_7d: number;
  views_7d: number;
  monthly_cents: number | null;
  overdue_count: number;
  equipment: number;
};

export type DevicePayload = {
  agent_version?: string;
  temp_c?: number;
  throttled?: string;
  buffer_alive?: boolean;
  segments?: number;
  load1?: number;
  mem_free_mb?: number;
  mem_total_mb?: number;
  uptime_s?: number;
};

export type DeviceRow = {
  id: string;
  venue_id: string;
  venue_name?: string;
  kind: string;
  name: string;
  agent_version: string | null;
  last_seen_at: string | null;
  last_payload: DevicePayload | null;
  revoked_at: string | null;
  created_at: string;
  online: boolean;
  issues: string[];
};

export type EquipmentKind = "camera" | "pi" | "switch" | "esp32" | "button" | "adapter" | "other";
export type EquipmentStatus = "stock" | "installed" | "maintenance" | "lost" | "retired";

export type EquipmentRow = {
  id: string;
  kind: EquipmentKind;
  model: string | null;
  serial: string | null;
  cost_cents: number | null;
  status: EquipmentStatus;
  venue_id: string | null;
  venue_name?: string | null;
  court_id: string | null;
  court_name?: string | null;
  device_id: string | null;
  device_name?: string | null;
  installed_at: string | null;
  notes: string | null;
  created_at: string;
};

export type EquipmentEvent = {
  id: number;
  type: "assigned" | "returned" | "maintenance" | "note";
  venue_id: string | null;
  venue_name: string | null;
  notes: string | null;
  created_at: string;
};

export type Contract = {
  id: string;
  venue_id: string;
  monthly_cents: number;
  due_day: number;
  start_date: string;
  end_date: string | null;
  notes: string | null;
};

export type Invoice = {
  id: string;
  venue_id: string;
  venue_name?: string;
  period: string;
  amount_cents: number;
  due_date: string;
  status: "open" | "paid" | "void";
  paid_at: string | null;
  paid_method: string | null;
  notes: string | null;
  overdue: boolean;
};

export type CourtRow = {
  id: string;
  name: string;
  public_key: string;
  created_at: string;
  clips_7d: number;
  clips_live: number;
};

export type VenueDetail = {
  venue: Omit<VenueRow, "courts" | "devices" | "devices_online" | "clips_7d" | "views_7d" | "monthly_cents" | "overdue_count" | "equipment">;
  courts: CourtRow[];
  devices: DeviceRow[];
  equipment: EquipmentRow[];
  contract: Contract | null;
  invoices: Invoice[];
  totals30: Record<string, number>;
  series: DayPoint[];
  access: { created_at: string; last_used_at: string | null } | null;
};

export type AdminClip = {
  id: string;
  status: string;
  bytes: number | null;
  expires_at: string;
  court_name: string;
  court_key: string;
  venue_name: string;
  time_local: string;
  views: number;
  downloads: number;
  thumb_url: string | null;
  play_url: string;
};

/* ----------------------------------------------------------- formatadores */

export { ago, brl, dateBr, num, periodLabel, todayBrt } from "../shared/format";

/** "1.234,56" / "1234.5" → centavos; null se não for número. */
export function parseBrl(s: string): number | null {
  const t = s.trim().replace(/^R\$\s*/, "");
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export const centsInput = (c: number | null | undefined) =>
  c === null || c === undefined ? "" : (c / 100).toFixed(2).replace(".", ",");

export const VENUE_STATUS_LABEL: Record<VenueStatus, string> = {
  onboarding: "Implantação",
  active: "Ativa",
  paused: "Pausada",
  churned: "Cancelada",
};

export const EQUIPMENT_KIND_LABEL: Record<EquipmentKind, string> = {
  camera: "Câmera",
  pi: "Raspberry Pi",
  switch: "Switch PoE",
  esp32: "ESP32",
  button: "Botoeira",
  adapter: "Adaptador",
  other: "Outro",
};

export const EQUIPMENT_STATUS_LABEL: Record<EquipmentStatus, string> = {
  stock: "Estoque",
  installed: "Instalado",
  maintenance: "Manutenção",
  lost: "Perdido",
  retired: "Baixado",
};

export const ERROR_LABEL: Record<string, string> = {
  invalid_token: "Token inválido",
  name_required: "Nome obrigatório",
  public_key_taken: "Esse código de quadra já existe",
  invalid_public_key: "Código inválido (3–32: a-z, 0-9, -)",
  serial_taken: "Esse número de série já está cadastrado",
  court_not_in_venue: "A quadra não é dessa arena",
  device_not_in_venue: "O dispositivo não é dessa arena",
  invalid_due_day: "Dia de vencimento deve ser entre 1 e 28",
  invalid_monthly_cents: "Valor inválido",
  invalid_start_date: "Data de início inválida",
  invoice_not_open: "Fatura não está em aberto",
};

export const errorText = (err: unknown) =>
  err instanceof ApiError ? (ERROR_LABEL[err.code] ?? err.code) : "Erro inesperado";
