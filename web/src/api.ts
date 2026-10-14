export type Court = {
  key: string;
  name: string;
  venue_name: string;
  retention_days: number;
  today: string;
};

export type ClipSummary = {
  id: string;
  bytes: number | null;
  expires_at: string;
  time_local: string;
  hour: number;
  thumb_url: string | null;
  play_url: string;
  download_url: string;
};

export type ClipDetail = {
  id: string;
  bytes: number | null;
  expires_at: string;
  date_local: string;
  time_local: string;
  court_key: string;
  court_name: string;
  venue_name: string;
  thumb_url: string | null;
  play_url: string;
  download_url: string;
};

export class NotFoundError extends Error {}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (res.status === 404) throw new NotFoundError(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
}

export const fetchCourt = (key: string) => getJson<Court>(`/api/courts/${encodeURIComponent(key)}`);

export const fetchClips = (key: string, date: string) =>
  getJson<{ date: string; clips: ClipSummary[] }>(
    `/api/courts/${encodeURIComponent(key)}/clips?date=${date}`,
  );

export const fetchClip = (id: string) => getJson<ClipDetail>(`/api/clips/${encodeURIComponent(id)}`);

export function sendEvent(id: string, type: "view" | "share"): void {
  void fetch(`/api/clips/${encodeURIComponent(id)}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type }),
    keepalive: true,
  }).catch(() => {});
}

/** "2026-10-13" ± n dias, sem passar por fuso local do aparelho. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "2026-10-20 18:00:00" (UTC) → "20/10" em Brasília. */
export function formatExpiry(expiresAtUtc: string): string {
  const d = new Date(`${expiresAtUtc.replace(" ", "T")}Z`);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
}
