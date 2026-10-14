import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import {
  adminFetch,
  brl,
  centsInput,
  dateBr,
  errorText,
  parseBrl,
  periodLabel,
  todayBrt,
  type Contract,
  type Invoice,
} from "./api";
import { Badge, Button, Empty, ErrorNote, Field, inputCls, Modal, Table } from "../shared/ui";

export function InvoiceStatus({ inv }: { inv: Invoice }) {
  if (inv.status === "paid") return <Badge tone="lime">Pago {inv.paid_at ? dateBr(inv.paid_at).slice(0, 5) : ""}</Badge>;
  if (inv.status === "void") return <Badge>Anulada</Badge>;
  if (inv.overdue) return <Badge tone="red">Atrasada</Badge>;
  return <Badge tone="blue">Em aberto</Badge>;
}

function PayModal({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  const qc = useQueryClient();
  const [method, setMethod] = useState("pix");
  const [paidAt, setPaidAt] = useState(todayBrt());
  const pay = useMutation({
    mutationFn: () => adminFetch(`/invoices/${inv.id}/pay`, "POST", { method, paid_at: paidAt }),
    onSuccess: () => {
      void qc.invalidateQueries();
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Dar baixa"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={pay.isPending} onClick={() => pay.mutate()}>
            Confirmar pagamento
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-zinc-400">
        {inv.venue_name ? `${inv.venue_name} · ` : ""}
        {periodLabel(inv.period)} · <span className="font-bold text-white">{brl(inv.amount_cents)}</span>
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Forma">
          <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="pix">Pix</option>
            <option value="boleto">Boleto</option>
            <option value="transfer">Transferência</option>
            <option value="cash">Dinheiro</option>
            <option value="other">Outro</option>
          </select>
        </Field>
        <Field label="Pago em">
          <input type="date" className={inputCls} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3">
        <ErrorNote>{pay.error && errorText(pay.error)}</ErrorNote>
      </div>
    </Modal>
  );
}

export function InvoiceTable({ invoices, showVenue = false }: { invoices: Invoice[]; showVenue?: boolean }) {
  const qc = useQueryClient();
  const [paying, setPaying] = useState<Invoice | null>(null);
  const action = useMutation({
    mutationFn: ({ id, op }: { id: string; op: "void" | "reopen" }) => adminFetch(`/invoices/${id}/${op}`, "POST"),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (!invoices.length) return <Empty>Nenhuma fatura.</Empty>;

  return (
    <>
      <Table>
        <thead>
          <tr>
            {showVenue && <th>Arena</th>}
            <th>Competência</th>
            <th>Vencimento</th>
            <th className="text-right">Valor</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id}>
              {showVenue && (
                <td>
                  <Link to={`/painel/arenas/${inv.venue_id}`} className="font-semibold hover:text-lime">
                    {inv.venue_name}
                  </Link>
                </td>
              )}
              <td className="capitalize">{periodLabel(inv.period)}</td>
              <td className={`tabular-nums ${inv.overdue ? "text-red-300" : ""}`}>{dateBr(inv.due_date)}</td>
              <td className="text-right font-semibold tabular-nums">{brl(inv.amount_cents)}</td>
              <td>
                <InvoiceStatus inv={inv} />
                {inv.paid_method && <span className="ml-1.5 text-xs text-zinc-500 uppercase">{inv.paid_method}</span>}
              </td>
              <td className="text-right whitespace-nowrap">
                {inv.status === "open" ? (
                  <span className="inline-flex gap-1.5">
                    <Button size="sm" variant="primary" onClick={() => setPaying(inv)}>
                      Dar baixa
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => confirm("Anular essa fatura?") && action.mutate({ id: inv.id, op: "void" })}
                    >
                      Anular
                    </Button>
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => confirm("Reabrir essa fatura?") && action.mutate({ id: inv.id, op: "reopen" })}
                  >
                    Reabrir
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {paying && <PayModal inv={paying} onClose={() => setPaying(null)} />}
    </>
  );
}

export function ContractModal({
  venueId,
  current,
  onClose,
}: {
  venueId: string;
  current: Contract | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState(centsInput(current?.monthly_cents));
  const [dueDay, setDueDay] = useState(String(current?.due_day ?? 10));
  const [start, setStart] = useState(current ? todayBrt().slice(0, 8) + "01" : todayBrt());
  const [notes, setNotes] = useState(current?.notes ?? "");
  const cents = parseBrl(value);

  const save = useMutation({
    mutationFn: () =>
      adminFetch<{ generated: number }>(`/venues/${venueId}/contract`, "PUT", {
        monthly_cents: cents,
        due_day: Number(dueDay),
        start_date: start,
        notes,
      }),
    onSuccess: () => {
      void qc.invalidateQueries();
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={current ? "Novo valor de contrato" : "Contrato"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={cents === null} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      {current && (
        <p className="mb-4 text-sm text-zinc-400">
          O contrato atual ({brl(current.monthly_cents)}) encerra na véspera do novo início. Faturas em aberto a partir
          desse mês são refeitas com o valor novo.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mensalidade (R$)">
          <input className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="350,00" autoFocus />
        </Field>
        <Field label="Dia do vencimento" hint="1 a 28">
          <input type="number" min={1} max={28} className={inputCls} value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
        </Field>
        <div className="col-span-2">
          <Field label="Início da cobrança" hint="Faturas retroativas são geradas desde esse mês.">
            <input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Observações">
            <textarea className={`${inputCls} min-h-16`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </div>
      <div className="mt-3">
        <ErrorNote>{save.error && errorText(save.error)}</ErrorNote>
      </div>
    </Modal>
  );
}
