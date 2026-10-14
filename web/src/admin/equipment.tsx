import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Pencil, Undo2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import {
  adminFetch,
  brl,
  centsInput,
  dateBr,
  EQUIPMENT_KIND_LABEL,
  EQUIPMENT_STATUS_LABEL,
  errorText,
  get,
  parseBrl,
  type EquipmentEvent,
  type EquipmentKind,
  type EquipmentRow,
  type EquipmentStatus,
  type VenueDetail,
  type VenueRow,
} from "./api";
import { Badge, Button, Empty, ErrorNote, Field, inputCls, Loading, Modal, Table } from "../shared/ui";

const STATUS_TONE: Record<EquipmentStatus, "lime" | "zinc" | "amber" | "red"> = {
  installed: "lime",
  stock: "zinc",
  maintenance: "amber",
  lost: "red",
  retired: "zinc",
};

export const equipmentTotal = (items: EquipmentRow[]) => items.reduce((s, e) => s + (e.cost_cents ?? 0), 0);

export function EquipmentTable({ items, showVenue = true }: { items: EquipmentRow[]; showVenue?: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<EquipmentRow | null>(null);
  const [history, setHistory] = useState<EquipmentRow | null>(null);
  const giveBack = useMutation({
    mutationFn: (id: string) => adminFetch(`/equipment/${id}`, "PATCH", { venue_id: null }),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (!items.length) return <Empty>Nenhum equipamento.</Empty>;

  return (
    <>
      <Table>
        <thead>
          <tr>
            <th>Equipamento</th>
            <th>Status</th>
            {showVenue && <th>Arena</th>}
            <th>Onde</th>
            <th className="text-right">Custo</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id}>
              <td>
                <p className="font-semibold">
                  {EQUIPMENT_KIND_LABEL[e.kind]}
                  {e.model && <span className="font-normal text-zinc-400"> · {e.model}</span>}
                </p>
                <p className="font-mono text-[11px] text-zinc-600">{e.serial ?? "sem série"}</p>
              </td>
              <td>
                <Badge tone={STATUS_TONE[e.status]}>{EQUIPMENT_STATUS_LABEL[e.status]}</Badge>
                {e.installed_at && <p className="mt-1 text-[11px] text-zinc-500">desde {dateBr(e.installed_at)}</p>}
              </td>
              {showVenue && (
                <td>
                  {e.venue_id ? (
                    <Link to={`/painel/arenas/${e.venue_id}`} className="hover:text-lime">
                      {e.venue_name}
                    </Link>
                  ) : (
                    <span className="text-zinc-600">—</span>
                  )}
                </td>
              )}
              <td className="text-xs text-zinc-400">
                {[e.court_name, e.device_name].filter(Boolean).join(" · ") || <span className="text-zinc-600">—</span>}
              </td>
              <td className="text-right tabular-nums">{e.cost_cents !== null ? brl(e.cost_cents) : "—"}</td>
              <td className="text-right whitespace-nowrap">
                <span className="inline-flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setHistory(e)} aria-label="Histórico">
                    <History className="size-3.5" />
                  </Button>
                  {e.venue_id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Devolver ao estoque"
                      title="Devolver ao estoque"
                      loading={giveBack.isPending && giveBack.variables === e.id}
                      onClick={() => confirm(`Devolver ${EQUIPMENT_KIND_LABEL[e.kind]} ao estoque?`) && giveBack.mutate(e.id)}
                    >
                      <Undo2 className="size-3.5" />
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(e)} aria-label="Editar">
                    <Pencil className="size-3.5" />
                  </Button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {editing && <EquipmentModal item={editing} onClose={() => setEditing(null)} />}
      {history && <HistoryModal item={history} onClose={() => setHistory(null)} />}
    </>
  );
}

type Form = {
  kind: EquipmentKind;
  model: string;
  serial: string;
  cost: string;
  status: EquipmentStatus;
  venue_id: string;
  court_id: string;
  device_id: string;
  notes: string;
};

/** Criar (sem item) ou editar. `venueId` pré-seleciona a arena ao criar a partir do detalhe. */
export function EquipmentModal({ item, venueId, onClose }: { item?: EquipmentRow; venueId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const initial: Form = {
    kind: item?.kind ?? "camera",
    model: item?.model ?? "",
    serial: item?.serial ?? "",
    cost: centsInput(item?.cost_cents),
    status: item?.status ?? (venueId ? "installed" : "stock"),
    venue_id: item?.venue_id ?? venueId ?? "",
    court_id: item?.court_id ?? "",
    device_id: item?.device_id ?? "",
    notes: item?.notes ?? "",
  };
  const [f, setF] = useState<Form>(initial);
  const [eventNote, setEventNote] = useState("");
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const venues = useQuery({ queryKey: ["venues"], queryFn: () => get<{ venues: VenueRow[] }>("/venues") });
  const detail = useQuery({
    queryKey: ["venue", f.venue_id],
    queryFn: () => get<VenueDetail>(`/venues/${f.venue_id}`),
    enabled: Boolean(f.venue_id),
  });

  const costCents = parseBrl(f.cost);
  const costInvalid = f.cost.trim() !== "" && costCents === null;

  const save = useMutation({
    mutationFn: () => {
      const full = {
        kind: f.kind,
        model: f.model,
        serial: f.serial,
        cost_cents: costCents,
        status: f.status,
        venue_id: f.venue_id || null,
        court_id: f.court_id || null,
        device_id: f.device_id || null,
        notes: f.notes,
      };
      if (!item) return adminFetch("/equipment", "POST", { ...full, event_note: eventNote });
      const changed: Record<string, unknown> = {};
      const keyOf = { cost_cents: "cost" } as Record<string, keyof Form>;
      for (const [k, v] of Object.entries(full)) {
        const formKey = keyOf[k] ?? (k as keyof Form);
        if (f[formKey] !== initial[formKey]) changed[k] = v;
      }
      if (eventNote.trim()) changed.event_note = eventNote;
      return adminFetch(`/equipment/${item.id}`, "PATCH", changed);
    },
    onSuccess: () => {
      void qc.invalidateQueries();
      onClose();
    },
  });

  const venueChanged = f.venue_id !== initial.venue_id;

  return (
    <Modal
      open
      onClose={onClose}
      title={item ? "Editar equipamento" : "Novo equipamento"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={costInvalid} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo">
          <select className={inputCls} value={f.kind} onChange={set("kind")}>
            {Object.entries(EQUIPMENT_KIND_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Modelo">
          <input className={inputCls} value={f.model} onChange={set("model")} placeholder="Tapo C320WS" />
        </Field>
        <Field label="Nº de série">
          <input className={`${inputCls} font-mono`} value={f.serial} onChange={set("serial")} />
        </Field>
        <Field label="Custo (R$)">
          <input className={inputCls} value={f.cost} onChange={set("cost")} inputMode="decimal" placeholder="289,90" />
        </Field>

        <div className="col-span-2">
          <Field label="Arena" hint={venueChanged && !item?.venue_id ? "Vira “Instalado” e registra a cessão." : undefined}>
            <select
              className={inputCls}
              value={f.venue_id}
              onChange={(e) => setF({ ...f, venue_id: e.target.value, court_id: "", device_id: "", status: e.target.value ? "installed" : "stock" })}
            >
              <option value="">Estoque (nenhuma)</option>
              {venues.data?.venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {f.venue_id && (
          <>
            <Field label="Quadra">
              <select className={inputCls} value={f.court_id} onChange={set("court_id")} disabled={!detail.data}>
                <option value="">—</option>
                {detail.data?.courts.map((co) => (
                  <option key={co.id} value={co.id}>
                    {co.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ligado ao Pi">
              <select className={inputCls} value={f.device_id} onChange={set("device_id")} disabled={!detail.data}>
                <option value="">—</option>
                {detail.data?.devices
                  .filter((d) => !d.revoked_at)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </Field>
          </>
        )}
        <div className="col-span-2">
          <Field label="Status">
            <select className={inputCls} value={f.status} onChange={set("status")}>
              {Object.entries(EQUIPMENT_STATUS_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Observações">
            <textarea className={`${inputCls} min-h-16`} value={f.notes} onChange={set("notes")} />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Nota no histórico" hint="Opcional. Ex.: trocado por defeito na fonte.">
            <input className={inputCls} value={eventNote} onChange={(e) => setEventNote(e.target.value)} />
          </Field>
        </div>
      </div>
      <div className="mt-3">
        <ErrorNote>{(save.error && errorText(save.error)) || (costInvalid && "Custo inválido")}</ErrorNote>
      </div>
    </Modal>
  );
}

const EVENT_LABEL: Record<EquipmentEvent["type"], string> = {
  assigned: "Cedido",
  returned: "Devolvido",
  maintenance: "Manutenção",
  note: "Nota",
};

function HistoryModal({ item, onClose }: { item: EquipmentRow; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["equipment-events", item.id],
    queryFn: () => get<{ events: EquipmentEvent[] }>(`/equipment/${item.id}/events`),
  });
  return (
    <Modal open onClose={onClose} title="Histórico">
      <p className="mb-4 text-sm text-zinc-400">
        {EQUIPMENT_KIND_LABEL[item.kind]} {item.model} <span className="font-mono text-zinc-600">{item.serial}</span>
      </p>
      {!q.data ? (
        <Loading />
      ) : !q.data.events.length ? (
        <Empty>Sem eventos.</Empty>
      ) : (
        <ol className="relative ml-2 border-l border-line">
          {q.data.events.map((ev) => (
            <li key={ev.id} className="mb-4 ml-4">
              <span className="absolute -left-1.5 mt-1.5 size-3 rounded-full border-2 border-surface bg-lime" />
              <p className="text-sm">
                <span className="font-semibold">{EVENT_LABEL[ev.type]}</span>
                {ev.venue_name && <span className="text-zinc-400"> · {ev.venue_name}</span>}
              </p>
              <p className="text-xs text-zinc-500">{dateBr(ev.created_at.slice(0, 10))}</p>
              {ev.notes && <p className="mt-1 text-sm text-zinc-300">{ev.notes}</p>}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
