import { useQuery } from "@tanstack/react-query";
import { ChevronRight, MapPin, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { brl, get, num, VENUE_STATUS_LABEL, type VenueRow, type VenueStatus } from "../api";
import { Badge, Button, Card, Empty, inputCls, Loading, PageHeader, StatusDot } from "../../shared/ui";
import { VenueFormModal } from "./VenueForm";

export const STATUS_TONE: Record<VenueStatus, "lime" | "blue" | "amber" | "zinc"> = {
  active: "lime",
  onboarding: "blue",
  paused: "amber",
  churned: "zinc",
};

export function VenuesPage() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["venues"], queryFn: () => get<{ venues: VenueRow[] }>("/venues") });
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<VenueStatus | "">("");

  const venues = (q.data?.venues ?? []).filter(
    (v) =>
      (!status || v.status === status) &&
      `${v.name} ${v.city ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Arenas"
        subtitle={q.data ? `${q.data.venues.length} cadastradas` : undefined}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Nova arena
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-600" />
          <input className={`${inputCls} pl-9`} placeholder="Buscar arena ou cidade" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className={`${inputCls} w-auto!`} value={status} onChange={(e) => setStatus(e.target.value as VenueStatus | "")}>
          <option value="">Todos os status</option>
          {Object.entries(VENUE_STATUS_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </div>

      {!q.data ? (
        <Loading />
      ) : venues.length === 0 ? (
        <Card>
          <Empty>Nenhuma arena encontrada.</Empty>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {venues.map((v) => {
            const allOnline = v.devices > 0 && v.devices_online === v.devices;
            return (
              <Link
                key={v.id}
                to={`/painel/arenas/${v.id}`}
                className="group rounded-2xl border border-line bg-surface p-4 transition hover:border-lime/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-bold">{v.name}</p>
                    <p className="flex items-center gap-1 text-xs text-zinc-500">
                      <MapPin className="size-3" /> {v.city ?? "Sem cidade"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {v.overdue_count > 0 && <Badge tone="red">{v.overdue_count} em atraso</Badge>}
                    <Badge tone={STATUS_TONE[v.status]}>{VENUE_STATUS_LABEL[v.status]}</Badge>
                    <ChevronRight className="size-4 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-lime" />
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
                  {[
                    ["Quadras", num(v.courts)],
                    ["Clips 7d", num(v.clips_7d)],
                    ["Views 7d", num(v.views_7d)],
                    ["Mensal", v.monthly_cents !== null ? brl(v.monthly_cents) : "—"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-ink/60 py-2">
                      <dt className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">{label}</dt>
                      <dd className="mt-0.5 text-sm font-bold tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
                  {v.devices ? (
                    <>
                      <StatusDot online={allOnline} />
                      {v.devices_online}/{v.devices} Pi online
                    </>
                  ) : (
                    <span className="text-zinc-600">Nenhum Pi cadastrado</span>
                  )}
                  <span className="text-zinc-700">·</span>
                  {num(v.equipment)} equipamentos
                </p>
              </Link>
            );
          })}
        </div>
      )}

      {creating && (
        <VenueFormModal open onClose={() => setCreating(false)} onSaved={(id) => navigate(`/painel/arenas/${id}`)} />
      )}
    </>
  );
}
