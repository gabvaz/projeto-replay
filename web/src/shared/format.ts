const brlFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const brl = (cents: number | null | undefined) => brlFmt.format((cents ?? 0) / 100);

export const num = (n: number | null | undefined) => (n ?? 0).toLocaleString("pt-BR");

/** "2026-10-14" → "14/10/2026". */
export const dateBr = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—";

/** "2026-10" → "out/26". */
export function periodLabel(p: string): string {
  const d = new Date(`${p}-15T12:00:00Z`);
  return d
    .toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" })
    .replace(". de ", "/")
    .replace(".", "");
}

/** Timestamp UTC do D1 → "há 3 min" / "há 2 h" / "há 3 dias". */
export function ago(utc: string | null | undefined): string {
  if (!utc) return "nunca";
  const ms = Date.now() - Date.parse(`${utc.replace(" ", "T")}Z`);
  const min = Math.round(ms / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

export const todayBrt = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
