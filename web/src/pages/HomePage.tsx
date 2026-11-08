import { ArrowRight, Check, Play } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { AppHeader } from "../components/AppHeader";
import { HowItWorks } from "../components/HowItWorks";
import { Logo, RecDot } from "../components/Logo";
import { paths } from "../routes";

/** Quadra estilizada (vista de cima) pra preencher o card do mockup. */
function CourtArt() {
  return (
    <svg viewBox="0 0 90 160" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="court" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2c30" />
          <stop offset="1" stopColor="#111214" />
        </linearGradient>
      </defs>
      <rect width="90" height="160" fill="url(#court)" />
      <g fill="none" stroke="rgb(255 255 255 / 0.4)" strokeWidth="1">
        <rect x="10" y="12" width="70" height="136" />
        <line x1="10" y1="80" x2="80" y2="80" strokeWidth="2" />
        <line x1="10" y1="44" x2="80" y2="44" />
        <line x1="10" y1="116" x2="80" y2="116" />
        <line x1="45" y1="44" x2="45" y2="116" />
      </g>
      <circle cx="58" cy="62" r="3.2" fill="var(--color-rec)" />
      <circle cx="58" cy="62" r="7" fill="var(--color-rec)" opacity="0.2" />
    </svg>
  );
}

function PhoneMockup() {
  return (
    <div className="relative mx-auto w-56 sm:w-64" aria-hidden>
      <div className="absolute -inset-10 rounded-full bg-rec/15 blur-3xl" />
      <div className="relative rotate-[4deg] rounded-[2.2rem] border border-white/10 bg-ink p-2 shadow-2xl shadow-black/60">
        <div className="relative aspect-[9/16] overflow-hidden rounded-[1.7rem]">
          <CourtArt />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/30" />
          <span className="font-mono absolute top-3 left-3 rounded-full bg-rec px-2 py-0.5 text-[10px] font-medium tracking-wider text-white">
            NOVO
          </span>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-white/20 backdrop-blur">
              <Play className="size-6 translate-x-0.5 fill-white text-white" />
            </span>
          </div>
          <div className="absolute inset-x-0 bottom-0 p-4">
            <p className="font-mono text-[10px] font-medium tracking-wider text-zinc-300">QUADRA 01</p>
            <p className="font-mono text-4xl leading-none">21:47</p>
          </div>
        </div>
      </div>
      <div className="animate-rise-in absolute -bottom-4 -left-6 flex items-center gap-2 rounded-2xl border border-line bg-surface/90 px-3 py-2 text-xs font-semibold shadow-xl backdrop-blur [animation-delay:400ms]">
        <span className="flex size-5 items-center justify-center rounded-full bg-ready text-white">
          <Check className="size-3.5" strokeWidth={3} />
        </span>
        Seu lance ficou salvo.
      </div>
    </div>
  );
}

function CourtCodeForm() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const key = code.trim().toLowerCase().replace(/\s+/g, "");
    if (key) navigate(paths.court(key), { viewTransition: true });
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm items-center gap-2 rounded-full border border-line bg-surface p-1.5 focus-within:border-white/40">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Código da quadra"
        aria-label="Código da quadra"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="font-mono min-w-0 flex-1 bg-transparent px-3 text-base outline-none placeholder:font-sans placeholder:text-zinc-500"
      />
      <button
        type="submit"
        disabled={!code.trim()}
        aria-label="Ver replays"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-ink transition hover:bg-nevoa disabled:opacity-40"
      >
        <ArrowRight className="size-5" />
      </button>
    </form>
  );
}

export function HomePage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-3xl flex-col gap-16 px-4 pt-6 pb-16">
        <section className="grid items-center gap-12 sm:grid-cols-[1.2fr_1fr]">
          <div className="animate-rise-in flex flex-col items-start gap-5">
            <span className="font-mono inline-flex items-center gap-2 rounded-full border border-rec/30 bg-rec/10 px-3 py-1 text-[11px] font-medium tracking-wider text-rec">
              <span className="animate-pulse-dot size-1.5 rounded-full bg-rec" />
              REC
            </span>
            <h1 className="font-display text-6xl leading-[0.92] sm:text-7xl">
              Seu melhor lance
              <RecDot />
              <br />
              Em 20 segundos
              <RecDot />
            </h1>
            <p className="max-w-md text-lg text-zinc-400">
              Apertou o botão, o vídeo tá no seu celular. Assista, baixe e poste — sem app, sem cadastro.
            </p>
            <CourtCodeForm />
            <p className="text-xs text-zinc-500">Ou escaneie o QR ao lado do botão da quadra.</p>
          </div>
          <PhoneMockup />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="font-display text-4xl leading-none">
            Como funciona
            <RecDot />
          </h2>
          <HowItWorks />
        </section>

        <footer className="flex items-center justify-between border-t border-line pt-6 text-xs text-zinc-500">
          <Logo className="h-7 opacity-80" />
          <span>Disponível por 7 dias · 1080p</span>
        </footer>
      </main>
    </>
  );
}
