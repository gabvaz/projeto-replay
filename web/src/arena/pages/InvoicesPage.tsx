import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { brl, dateBr, periodLabel } from "../../shared/format";
import { Badge, buttonCls, Card, Empty, Kpi, Loading, PageHeader } from "../../shared/ui";
import { useMe } from "../ArenaLayout";
import { get, type ArenaInvoice } from "../api";

function Status({ inv }: { inv: ArenaInvoice }) {
  if (inv.status === "paid") return <Badge tone="lime">Pago</Badge>;
  if (inv.status === "void") return <Badge>Cancelada</Badge>;
  if (inv.overdue) return <Badge tone="red">Atrasada</Badge>;
  return <Badge tone="blue">Em aberto</Badge>;
}

export function InvoicesPage() {
  const me = useMe();
  const q = useQuery({
    queryKey: ["invoices"],
    queryFn: () => get<{ invoices: ArenaInvoice[]; contract: { monthly_cents: number; due_day: number } | null }>("/invoices"),
  });
  if (!q.data) return <Loading />;
  const { invoices, contract } = q.data;
  const open = invoices.filter((i) => i.status === "open");
  const overdue = open.filter((i) => i.overdue);
  const wa = me.data?.support_whatsapp;

  return (
    <>
      <PageHeader title="Faturas" subtitle="Mensalidade do sistema de replay" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi
          label="Mensalidade"
          value={contract ? brl(contract.monthly_cents) : "—"}
          hint={contract ? `vence todo dia ${contract.due_day}` : "sem contrato ativo"}
          tone="lime"
        />
        <Kpi
          label="Em aberto"
          value={brl(open.reduce((s, i) => s + i.amount_cents, 0))}
          tone={overdue.length ? "red" : undefined}
          hint={overdue.length ? `${overdue.length} atrasada(s)` : `${open.length} fatura(s)`}
        />
      </div>

      {overdue.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <span>Tem mensalidade atrasada. Fala com a gente pra acertar.</span>
          {wa && (
            <a
              href={`https://wa.me/${wa}?text=${encodeURIComponent(`Oi! Quero acertar a mensalidade da ${me.data?.brand.name}.`)}`}
              target="_blank"
              rel="noreferrer"
              className={buttonCls("primary", "sm")}
            >
              <MessageCircle className="size-3.5" /> WhatsApp
            </a>
          )}
        </div>
      )}

      <Card title="Histórico" className="mt-4" pad={false}>
        {invoices.length ? (
          <ul className="divide-y divide-line">
            {invoices.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold capitalize">{periodLabel(inv.period)}</p>
                  <p className={`text-xs ${inv.overdue ? "text-red-300" : "text-zinc-500"}`}>
                    {inv.status === "paid" && inv.paid_at ? `pago em ${dateBr(inv.paid_at)}` : `vence ${dateBr(inv.due_date)}`}
                  </p>
                </div>
                <span className="font-semibold tabular-nums">{brl(inv.amount_cents)}</span>
                <Status inv={inv} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Nenhuma fatura ainda.</Empty>
        )}
      </Card>
      <p className="mt-3 text-xs text-zinc-600">Pagamento por Pix direto pelo portal chega em breve.</p>
    </>
  );
}
