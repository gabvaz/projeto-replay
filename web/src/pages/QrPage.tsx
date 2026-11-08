import { useQuery } from "@tanstack/react-query";
import { Hand, Printer, ScanLine, Share2 } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { fetchCourt } from "../api";
import { Logo, RecDot } from "../components/Logo";
import { brandStyle } from "../shared/brand";

const STEPS = [
  { icon: Hand, title: "Aperte.", text: "Logo depois da jogada" },
  { icon: ScanLine, title: "O loop salva.", text: "Os últimos 20 segundos" },
  { icon: Share2, title: "Reveja.", text: "Baixe e poste seu lance" },
] as const;

/** Pôster A4 pra imprimir e colar ao lado da botoeira (Ctrl+P → Salvar como PDF). */
export function QrPage() {
  const { key = "" } = useParams();
  const court = useQuery({ queryKey: ["court", key], queryFn: () => fetchCourt(key) });
  const [svg, setSvg] = useState("");
  const url = `${location.origin}/quadra/${key}`;

  useEffect(() => {
    void QRCode.toString(url, {
      type: "svg",
      margin: 0,
      errorCorrectionLevel: "M",
      color: { dark: "#111214", light: "#ffffff" },
    }).then(setSvg);
  }, [url]);

  const brand = court.data?.brand;

  return (
    <div
      style={brandStyle(brand?.color)}
      className="flex min-h-svh flex-col items-center gap-6 bg-paper px-4 py-8 print:block print:bg-white print:p-0"
    >
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white print:hidden"
      >
        <Printer className="size-4" />
        Imprimir / salvar PDF
      </button>

      <article className="flex aspect-[210/297] w-full max-w-[210mm] flex-col overflow-hidden bg-paper text-ink shadow-2xl print:h-[297mm] print:w-[210mm] print:max-w-none print:shadow-none">
        <header className="flex items-center justify-between bg-ink px-[7%] py-[4%] text-white">
          <Logo className="h-10 origin-left scale-110" />
          <span className="font-mono flex items-center gap-3 text-[clamp(10px,1.6vw,14px)] font-medium tracking-wider text-zinc-400">
            {court.data?.venue_name}
            {brand?.logo_url && (
              <img src={brand.logo_url} alt="" className="size-[clamp(36px,7vw,64px)] rounded-lg object-contain" />
            )}
          </span>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center gap-[3%] px-[7%] text-center">
          <p className="font-mono text-[clamp(12px,2vw,18px)] font-medium tracking-wider text-asfalto">
            Aperte. Grave. Reveja.
          </p>
          <h1 className="font-display text-[clamp(48px,11vw,110px)] leading-[0.88] text-ink">
            {court.data?.name ?? key}
            <RecDot />
          </h1>

          <div className="relative w-[58%] rounded-[8%] bg-lime p-[4%]">
            <div className="rounded-[6%] bg-white p-[6%]" dangerouslySetInnerHTML={{ __html: svg }} />
          </div>

          <ol className="grid w-full grid-cols-3 gap-[3%]">
            {STEPS.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="flex flex-col items-center gap-1">
                <span className="flex size-[clamp(36px,6vw,56px)] items-center justify-center rounded-full bg-ink text-white">
                  <Icon className="size-1/2" />
                </span>
                <span className="font-display text-[clamp(16px,2.8vw,26px)] leading-none">
                  {String(i + 1).padStart(2, "0")} {title.replace(".", "")}
                  <RecDot />
                </span>
                <span className="text-[clamp(10px,1.6vw,14px)] text-asfalto">{text}</span>
              </li>
            ))}
          </ol>
        </div>

        <footer className="flex items-center justify-between border-t border-ink/10 px-[7%] py-[3%]">
          <span className="text-[clamp(10px,1.6vw,14px)] text-asfalto">Sem app. Sem cadastro.</span>
          <span className="font-mono text-[clamp(10px,1.6vw,14px)] font-medium">
            {url.replace(/^https?:\/\//, "")}
          </span>
        </footer>
      </article>
    </div>
  );
}
