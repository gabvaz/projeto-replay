import { useQuery } from "@tanstack/react-query";
import { Check, ExternalLink, QrCode, Share2 } from "lucide-react";
import { useState } from "react";
import { ago, num } from "../../shared/format";
import { Button, buttonCls, Card, Empty, Loading, PageHeader } from "../../shared/ui";
import { get, type Court } from "../api";

function ShareButton({ court }: { court: Court }) {
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}/q/${court.public_key}`;
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        if (navigator.share) {
          await navigator.share({ title: court.name, text: "Seus lances na quadra:", url }).catch(() => {});
        } else {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Share2 className="size-3.5" />}
      {copied ? "Copiado" : "Compartilhar"}
    </Button>
  );
}

export function CourtsPage() {
  const q = useQuery({ queryKey: ["courts"], queryFn: () => get<{ courts: Court[] }>("/courts") });

  return (
    <>
      <PageHeader title="Quadras" subtitle="Imprima o cartaz com QR e cole perto do botão de cada quadra" />
      {!q.data ? (
        <Loading />
      ) : !q.data.courts.length ? (
        <Card>
          <Empty>Nenhuma quadra ainda. A equipe Replay cadastra na instalação.</Empty>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {q.data.courts.map((co) => (
            <div key={co.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold">{co.name}</p>
                  <p className="font-mono text-xs text-zinc-500">/q/{co.public_key}</p>
                </div>
                <p className="text-right text-xs text-zinc-400 tabular-nums">
                  {num(co.clips_7d)} clips em 7d
                  <br />
                  <span className="text-zinc-600">último {ago(co.last_clip_at)}</span>
                </p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href={`/q/${co.public_key}/qr`} target="_blank" rel="noreferrer" className={buttonCls("primary", "sm")}>
                  <QrCode className="size-3.5" /> Cartaz QR
                </a>
                <a href={`/q/${co.public_key}`} target="_blank" rel="noreferrer" className={buttonCls("subtle", "sm")}>
                  <ExternalLink className="size-3.5" /> Ver galeria
                </a>
                <ShareButton court={co} />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
