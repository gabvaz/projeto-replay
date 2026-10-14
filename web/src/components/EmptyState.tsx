import { HowItWorks } from "./HowItWorks";

/** Botoeira sendo apertada, com onda saindo. */
function ButtonIllustration() {
  return (
    <div className="relative mx-auto flex size-36 items-center justify-center" aria-hidden>
      <span className="animate-ring absolute size-24 rounded-full border-2 border-lime" />
      <span className="animate-ring absolute size-24 rounded-full border-2 border-lime [animation-delay:0.3s]" />
      <div className="relative size-24 rounded-full bg-surface-2 shadow-[inset_0_-6px_0_rgb(0_0_0/0.5)] ring-1 ring-line">
        <div className="animate-press absolute inset-3 rounded-full bg-lime shadow-[0_6px_0_var(--color-lime-dim),0_0_40px_rgb(215_255_58/0.35)]" />
      </div>
    </div>
  );
}

export function EmptyState({ isToday }: { isToday: boolean }) {
  return (
    <div className="animate-rise-in flex flex-col items-center gap-6 py-8 text-center">
      <ButtonIllustration />
      <div>
        <p className="font-display text-4xl leading-none font-black uppercase italic">
          {isToday ? "Nenhum replay ainda" : "Nada neste dia"}
        </p>
        <p className="mx-auto mt-2 max-w-sm text-zinc-400">
          {isToday
            ? "Aperte o botão na quadra — seu lance aparece aqui em segundos, sem precisar recarregar."
            : "Ninguém apertou o botão nesse dia. Escolha outro dia acima."}
        </p>
      </div>
      {isToday && <HowItWorks className="w-full" />}
    </div>
  );
}
