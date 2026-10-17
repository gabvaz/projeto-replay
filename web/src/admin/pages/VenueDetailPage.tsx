import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  QrCode,
  Trash2,
  User,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import {
  adminFetch,
  ago,
  brl,
  dateBr,
  errorText,
  get,
  num,
  todayBrt,
  VENUE_STATUS_LABEL,
  type AdminClip,
  type CourtRow,
  type VenueDetail,
} from "../api";
import { DailyChart } from "../../shared/charts";
import { CreateDeviceModal, DeviceTable } from "../devices";
import { EquipmentModal, EquipmentTable, equipmentTotal } from "../equipment";
import { ContractModal, InvoiceTable } from "../invoices";
import { Badge, Button, buttonCls, Card, Empty, ErrorNote, Field, inputCls, Kpi, Loading, Modal, PageHeader, Tabs } from "../../shared/ui";
import { VenueFormModal } from "./VenueForm";
import { STATUS_TONE } from "./VenuesPage";

type Tab = "resumo" | "quadras" | "dispositivos" | "equipamentos" | "financeiro" | "clips";

export function VenueDetailPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("aba") as Tab | null) ?? "resumo";
  const q = useQuery({ queryKey: ["venue", id], queryFn: () => get<VenueDetail>(`/venues/${id}`) });
  const [editing, setEditing] = useState(false);

  if (q.error) return <ErrorNote>{errorText(q.error)}</ErrorNote>;
  if (!q.data) return <Loading />;
  const d = q.data;
  const v = d.venue;
  const activeDevices = d.devices.filter((x) => !x.revoked_at);
  const overdue = d.invoices.filter((i) => i.overdue).length;

  return (
    <>
      <Link to="/painel/arenas" className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-white">
        <ArrowLeft className="size-4" /> Arenas
      </Link>
      <PageHeader
        title={v.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[v.status]}>{VENUE_STATUS_LABEL[v.status]}</Badge>
            {v.city && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" /> {v.city}
              </span>
            )}
            {overdue > 0 && <Badge tone="red">{overdue} fatura(s) em atraso</Badge>}
          </span>
        }
        actions={
          <span className="flex gap-2">
            {v.public_key && (
              <a
                href={`/g/${v.public_key}`}
                target="_blank"
                rel="noreferrer"
                className={buttonCls("subtle")}
              >
                <ExternalLink className="size-4" /> Galeria
              </a>
            )}
            <Button onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Editar
            </Button>
          </span>
        }
      />

      <Tabs<Tab>
        value={tab}
        onChange={(t) => setParams(t === "resumo" ? {} : { aba: t }, { replace: true })}
        tabs={[
          { id: "resumo", label: "Resumo" },
          { id: "quadras", label: "Quadras", count: d.courts.length },
          { id: "dispositivos", label: "Dispositivos", count: activeDevices.length },
          { id: "equipamentos", label: "Equipamentos", count: d.equipment.length },
          { id: "financeiro", label: "Financeiro" },
          { id: "clips", label: "Clips" },
        ]}
      />

      {tab === "resumo" && <SummaryTab d={d} />}
      {tab === "quadras" && <CourtsTab venueId={id} courts={d.courts} />}
      {tab === "dispositivos" && <DevicesTab venueId={id} d={d} />}
      {tab === "equipamentos" && <EquipmentTab venueId={id} d={d} />}
      {tab === "financeiro" && <FinanceTab venueId={id} d={d} />}
      {tab === "clips" && <ClipsTab venueId={id} />}

      {editing && <VenueFormModal open venueId={id} initial={v} onClose={() => setEditing(false)} />}
    </>
  );
}

/* ----------------------------------------------------------------- resumo */

function SummaryTab({ d }: { d: VenueDetail }) {
  const t = d.totals30;
  const v = d.venue;
  const contacts = [
    { icon: User, value: v.contact_name },
    { icon: Phone, value: v.contact_phone, href: v.contact_phone ? `https://wa.me/55${v.contact_phone.replace(/\D/g, "")}` : undefined },
    { icon: Mail, value: v.contact_email, href: v.contact_email ? `mailto:${v.contact_email}` : undefined },
  ].filter((c) => c.value);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Clips 30d" value={num(t.created)} />
        <Kpi label="Views 30d" value={num(t.view)} hint={t.created ? `${((t.view ?? 0) / t.created).toFixed(1)} por clip` : undefined} />
        <Kpi label="Downloads 30d" value={num(t.download)} />
        <Kpi label="Shares 30d" value={num(t.share)} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Uso diário" className="lg:col-span-2">
          <DailyChart series={d.series} today={todayBrt()} />
        </Card>
        <Card title="Contato">
          {contacts.length ? (
            <ul className="flex flex-col gap-2.5 text-sm">
              {contacts.map(({ icon: Icon, value, href }) => (
                <li key={value} className="flex items-center gap-2">
                  <Icon className="size-4 shrink-0 text-zinc-500" />
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer" className="truncate hover:text-lime">
                      {value}
                    </a>
                  ) : (
                    <span className="truncate">{value}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">Sem contato cadastrado.</p>
          )}
          {v.notes && <p className="mt-4 border-t border-line pt-3 text-sm whitespace-pre-line text-zinc-400">{v.notes}</p>}
          <p className="mt-4 text-xs text-zinc-600">Cliente desde {dateBr(v.created_at.slice(0, 10))}</p>
        </Card>
      </div>
      <AccessCard venueId={v.id} venueName={v.name} phone={v.contact_phone} access={d.access} />
    </>
  );
}

/** Link do portal da arena: o token só existe na resposta do POST, então aparece uma vez. */
function AccessCard({
  venueId,
  venueName,
  phone,
  access,
}: {
  venueId: string;
  venueName: string;
  phone: string | null;
  access: VenueDetail["access"];
}) {
  const qc = useQueryClient();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    mutationFn: () => adminFetch<{ url: string }>(`/venues/${venueId}/access-link`, "POST"),
    onSuccess: (r) => {
      setUrl(r.url);
      setCopied(false);
      void qc.invalidateQueries({ queryKey: ["venue", venueId] });
    },
  });
  const revoke = useMutation({
    mutationFn: () => adminFetch(`/venues/${venueId}/access-link`, "DELETE"),
    onSuccess: () => {
      setUrl(null);
      void qc.invalidateQueries({ queryKey: ["venue", venueId] });
    },
  });
  const message = url
    ? `Oi! Esse é o acesso ao portal da ${venueName} no Replay (estatísticas, clips, cartazes QR e faturas): ${url}`
    : "";
  const waNumber = phone?.replace(/\D/g, "");

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <KeyRound className="size-4 text-lime" /> Acesso da arena
        </span>
      }
      className="mt-4"
    >
      {url ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-amber-200">Esse link não aparece de novo. Manda agora pro responsável.</p>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-ink p-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-lime">{url}</code>
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(url);
                setCopied(true);
              }}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
          <a
            href={`https://wa.me/${waNumber ? `55${waNumber}` : ""}?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noreferrer"
            className={`${buttonCls("primary", "sm")} self-start`}
          >
            <MessageCircle className="size-3.5" /> Enviar no WhatsApp
          </a>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zinc-400">
            {access
              ? `Link ativo desde ${dateBr(access.created_at.slice(0, 10))} · último acesso ${ago(access.last_used_at)}`
              : "Nenhum link ativo. A arena ainda não acessa o portal."}
          </p>
          <span className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              loading={create.isPending}
              onClick={() =>
                (!access || confirm("Gerar um link novo derruba o atual (quem estiver logado sai). Continuar?")) &&
                create.mutate()
              }
            >
              {access ? "Gerar novo link" : "Gerar link"}
            </Button>
            {access && (
              <Button
                size="sm"
                variant="danger"
                loading={revoke.isPending}
                onClick={() => confirm("Revogar o acesso da arena agora?") && revoke.mutate()}
              >
                Revogar
              </Button>
            )}
          </span>
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- quadras */

function CourtModal({ venueId, court, onClose }: { venueId: string; court?: CourtRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(court?.name ?? "");
  const [key, setKey] = useState(court?.public_key ?? "");
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, string> = { name };
      if (key.trim() && key !== court?.public_key) body.public_key = key.trim();
      return court ? adminFetch(`/courts/${court.id}`, "PATCH", body) : adminFetch(`/venues/${venueId}/courts`, "POST", body);
    },
    onSuccess: () => {
      void qc.invalidateQueries();
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={court ? "Editar quadra" : "Nova quadra"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Nome">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Quadra 1" autoFocus />
        </Field>
        <Field
          label="Código do QR"
          hint={
            court
              ? "Mudar o código invalida os QR codes já impressos."
              : "Opcional. Em branco, gera a partir do nome da arena + quadra."
          }
        >
          <input
            className={`${inputCls} font-mono`}
            value={key}
            onChange={(e) => setKey(e.target.value.toLowerCase())}
            placeholder="arena-beach-q1"
          />
        </Field>
      </div>
      <div className="mt-3">
        <ErrorNote>{save.error && errorText(save.error)}</ErrorNote>
      </div>
    </Modal>
  );
}

function CourtsTab({ venueId, courts }: { venueId: string; courts: CourtRow[] }) {
  const [modal, setModal] = useState<CourtRow | "new" | null>(null);
  return (
    <Card
      title="Quadras"
      pad={false}
      actions={
        <Button size="sm" variant="primary" onClick={() => setModal("new")}>
          <Plus className="size-3.5" /> Quadra
        </Button>
      }
    >
      {courts.length ? (
        <ul className="divide-y divide-line">
          {courts.map((co) => (
            <li key={co.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{co.name}</p>
                <p className="font-mono text-xs text-zinc-500">/q/{co.public_key}</p>
              </div>
              <p className="text-xs text-zinc-400 tabular-nums">
                {num(co.clips_7d)} clips 7d · {num(co.clips_live)} no ar
              </p>
              <span className="flex gap-1">
                <a href={`/q/${co.public_key}/qr`} target="_blank" rel="noreferrer" className={buttonCls("subtle", "sm")}>
                  <QrCode className="size-3.5" /> Cartaz
                </a>
                <a
                  href={`/q/${co.public_key}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Abrir galeria"
                  className={buttonCls("ghost", "sm")}
                >
                  <ExternalLink className="size-3.5" />
                </a>
                <Button size="sm" variant="ghost" onClick={() => setModal(co)} aria-label="Editar">
                  <Pencil className="size-3.5" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Nenhuma quadra. Cadastre a primeira pra gerar o QR.</Empty>
      )}
      {modal && <CourtModal venueId={venueId} court={modal === "new" ? undefined : modal} onClose={() => setModal(null)} />}
    </Card>
  );
}

/* ----------------------------------------------------------- dispositivos */

function DevicesTab({ venueId, d }: { venueId: string; d: VenueDetail }) {
  const [creating, setCreating] = useState(false);
  return (
    <Card
      title="Raspberry Pi"
      pad={false}
      actions={
        <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" /> Dispositivo
        </Button>
      }
    >
      <DeviceTable devices={d.devices} />
      {creating && <CreateDeviceModal open venueId={venueId} onClose={() => setCreating(false)} />}
    </Card>
  );
}

/* ----------------------------------------------------------- equipamentos */

function EquipmentTab({ venueId, d }: { venueId: string; d: VenueDetail }) {
  const [creating, setCreating] = useState(false);
  const live = d.equipment.filter((e) => e.status !== "retired" && e.status !== "lost");
  return (
    <Card
      title={
        <>
          Cedidos à arena <span className="ml-2 font-normal text-zinc-500">{brl(equipmentTotal(live))} em equipamento</span>
        </>
      }
      pad={false}
      actions={
        <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" /> Equipamento
        </Button>
      }
    >
      <EquipmentTable items={d.equipment} showVenue={false} />
      <p className="border-t border-line px-4 py-3 text-xs text-zinc-500">
        Pra ceder algo do estoque, abre em <Link to="/painel/equipamentos" className="text-lime hover:underline">Equipamentos</Link> e
        troca a arena.
      </p>
      {creating && <EquipmentModal venueId={venueId} onClose={() => setCreating(false)} />}
    </Card>
  );
}

/* ------------------------------------------------------------- financeiro */

function FinanceTab({ venueId, d }: { venueId: string; d: VenueDetail }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const end = useMutation({
    mutationFn: () => adminFetch(`/venues/${venueId}/contract`, "DELETE"),
    onSuccess: () => qc.invalidateQueries(),
  });
  const c = d.contract;
  const open = d.invoices.filter((i) => i.status === "open");
  const overdue = open.filter((i) => i.overdue);
  const paid = d.invoices.filter((i) => i.status === "paid");

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface p-4 sm:col-span-1">
          <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Contrato</p>
          {c ? (
            <>
              <p className="font-display mt-1 text-4xl leading-none font-extrabold text-lime tabular-nums">
                {brl(c.monthly_cents)}
                <span className="text-base text-zinc-500">/mês</span>
              </p>
              <p className="mt-1.5 text-xs text-zinc-500">
                Vence dia {c.due_day} · desde {dateBr(c.start_date)}
                {c.end_date && ` · até ${dateBr(c.end_date)}`}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-zinc-400">Sem contrato ativo.</p>
          )}
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant={c ? "subtle" : "primary"} onClick={() => setEditing(true)}>
              {c ? "Reajustar" : "Criar contrato"}
            </Button>
            {c && !c.end_date && (
              <Button
                size="sm"
                variant="ghost"
                loading={end.isPending}
                onClick={() => confirm("Encerrar o contrato hoje? Para de gerar faturas novas.") && end.mutate()}
              >
                Encerrar
              </Button>
            )}
          </div>
        </div>
        <Kpi
          label="Em aberto"
          value={brl(open.reduce((s, i) => s + i.amount_cents, 0))}
          tone={overdue.length ? "red" : undefined}
          hint={overdue.length ? `${overdue.length} atrasada(s)` : `${open.length} fatura(s)`}
        />
        <Kpi label="Recebido" value={brl(paid.reduce((s, i) => s + i.amount_cents, 0))} hint={`${paid.length} fatura(s) pagas`} />
      </div>
      <Card title="Faturas" className="mt-4" pad={false}>
        <InvoiceTable invoices={d.invoices} />
      </Card>
      {editing && <ContractModal venueId={venueId} current={c} onClose={() => setEditing(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ clips */

function ClipsTab({ venueId }: { venueId: string }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayBrt());
  const q = useQuery({
    queryKey: ["admin-clips", venueId, date],
    queryFn: () => get<{ clips: AdminClip[] }>(`/clips?venue=${venueId}&date=${date}`),
  });
  const del = useMutation({
    mutationFn: (clipId: string) => adminFetch(`/clips/${clipId}`, "DELETE"),
    onSuccess: () => qc.invalidateQueries(),
  });

  return (
    <Card
      title="Clips do dia"
      actions={<input type="date" className={`${inputCls} w-auto! py-1`} value={date} max={todayBrt()} onChange={(e) => setDate(e.target.value)} />}
    >
      {!q.data ? (
        <Loading />
      ) : !q.data.clips.length ? (
        <Empty>Nenhum clip nesse dia.</Empty>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {q.data.clips.map((cl) => (
            <li key={cl.id} className="overflow-hidden rounded-xl border border-line bg-ink">
              <a href={`/v/${cl.id}`} target="_blank" rel="noreferrer" className="relative block aspect-video bg-surface-2">
                {cl.thumb_url && <img src={cl.thumb_url} alt="" loading="lazy" className="size-full object-cover" />}
                <span className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-xs font-bold tabular-nums">
                  {cl.time_local}
                </span>
                {cl.status !== "ready" && (
                  <span className="absolute top-1.5 right-1.5">
                    <Badge tone="amber">{cl.status}</Badge>
                  </span>
                )}
              </a>
              <div className="flex items-center gap-2 px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{cl.court_name}</p>
                  <p className="text-[11px] text-zinc-500 tabular-nums">
                    {cl.views} views · {cl.downloads} dl
                    {cl.bytes ? ` · ${(cl.bytes / 1_048_576).toFixed(1)} MB` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Apagar clip"
                  loading={del.isPending && del.variables === cl.id}
                  onClick={() => confirm("Apagar esse clip de vez (R2 + banco)?") && del.mutate(cl.id)}
                >
                  <Trash2 className="size-3.5 text-red-300" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
