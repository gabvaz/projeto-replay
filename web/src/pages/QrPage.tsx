import { useQuery } from "@tanstack/react-query";
import { Hand, Printer, ScanLine, Share2 } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { fetchCourt } from "../api";
import { Logo } from "../components/Logo";

const STEPS = [
  { icon: Hand, title: "Aperte o botão", text: "Salva os últimos 20s" },
  { icon: ScanLine, title: "Escaneie", text: "Abra a câmera do celular" },
  { icon: Share2, title: "Compartilhe", text: "Baixe e poste seu lance" },
] as const;

/** Pôster A4 pra imprimir e colar ao lado da botoeira (Ctrl+P → Salvar como PDF). */
export function QrPage() {
  const { key = "" } = useParams();
  const court = useQuery({ queryKey: ["court", key], queryFn: () => fetchCourt(key) });
  const [svg, setSvg] = useState("");
  const url = `${location.origin}/q/${key}`;

  useEffect(() => {
    void QRCode.toString(url, {
      type: "svg",
      margin: 0,
      errorCorrectionLevel: "M",
      color: { dark: "#07090a", light: "#ffffff" },
    }).then(setSvg);
  }, [url]);

  return (
    <div className="flex min-h-svh flex-col items-center gap-6 px-4 py-8 print:block print:p-0">
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 rounded-full bg-lime px-5 py-2.5 text-sm font-bold text-ink print:hidden"
      >
        <Printer className="size-4" />
        Imprimir / salvar PDF
      </button>

      <article className="flex aspect-[210/297] w-full max-w-[210mm] flex-col overflow-hidden bg-white text-ink shadow-2xl print:h-[297mm] print:w-[210mm] print:max-w-none print:shadow-none">
        <header className="flex items-center justify-between bg-ink px-[7%] py-[4%] text-white">
          <Logo className="scale-125 origin-left" />
          <span className="text-[clamp(10px,1.6vw,14px)] font-semibold tracking-[0.2em] text-zinc-400 uppercase">
            {court.data?.venue_name}
          </span>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center gap-[3%] px-[7%] text-center">
          <p className="text-[clamp(12px,2vw,18px)] font-bold tracking-[0.3em] text-zinc-500 uppercase">
            Replay instantâneo
          </p>
          <h1 className="font-display text-[clamp(48px,11vw,110px)] leading-[0.85] font-black uppercase italic">
            {court.data?.name ?? key}
          </h1>

          <div className="relative w-[58%] rounded-[8%] bg-lime p-[4%]">
            <div className="rounded-[6%] bg-white p-[6%]" dangerouslySetInnerHTML={{ __html: svg }} />
          </div>

          <ol className="grid w-full grid-cols-3 gap-[3%]">
            {STEPS.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="flex flex-col items-center gap-1">
                <span className="flex size-[clamp(36px,6vw,56px)] items-center justify-center rounded-full bg-ink text-lime">
                  <Icon className="size-1/2" />
                </span>
                <span className="font-display text-[clamp(16px,2.8vw,26px)] leading-none font-black uppercase italic">
                  {i + 1}. {title}
                </span>
                <span className="text-[clamp(10px,1.6vw,14px)] text-zinc-500">{text}</span>
              </li>
            ))}
          </ol>
        </div>

        <footer className="flex items-center justify-between border-t-4 border-lime px-[7%] py-[3%]">
          <span className="text-[clamp(10px,1.6vw,14px)] text-zinc-500">Sem app. Sem cadastro.</span>
          <span className="font-mono text-[clamp(10px,1.6vw,14px)] font-semibold">
            {url.replace(/^https?:\/\//, "")}
          </span>
        </footer>
      </article>
    </div>
  );
}
