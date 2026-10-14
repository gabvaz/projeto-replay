import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { fetchCourt } from "../api";

/** Folha A4 pra imprimir e colar ao lado da botoeira (Ctrl+P → Salvar como PDF). */
export function QrPage() {
  const { key = "" } = useParams();
  const court = useQuery({ queryKey: ["court", key], queryFn: () => fetchCourt(key) });
  const [svg, setSvg] = useState("");
  const url = `${location.origin}/q/${key}`;

  useEffect(() => {
    void QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then(setSvg);
  }, [url]);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 bg-white p-10 text-center text-black">
      <p className="text-lg uppercase tracking-widest text-zinc-500">{court.data?.venue_name}</p>
      <h1 className="text-5xl font-black">{court.data?.name ?? key}</h1>
      <div className="w-full max-w-sm" dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="text-2xl font-bold">1. Aperte o botão &nbsp;·&nbsp; 2. Escaneie</p>
      <p className="text-lg text-zinc-600">Seu replay dos últimos 20 segundos aparece aqui</p>
      <p className="font-mono text-sm text-zinc-400">{url}</p>
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-lg bg-black px-6 py-3 font-semibold text-white print:hidden"
      >
        Imprimir / salvar PDF
      </button>
    </main>
  );
}
