import { ChevronLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Logo } from "./Logo";

type Props = {
  /** Mostra "voltar" pra galeria da quadra no lugar do logo grande. */
  backTo?: string;
  backLabel?: string;
};

/** Topo transparente que ganha blur ao rolar. O slot à direita é do logo da arena/patrocinador. */
export function AppHeader({ backTo, backLabel }: Props) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-30 pt-[env(safe-area-inset-top)] transition-colors duration-300 ${
        scrolled ? "border-b border-line bg-ink/80 backdrop-blur-xl" : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
        {backTo ? (
          <Link
            to={backTo}
            viewTransition
            className="-ml-2 flex min-w-0 items-center gap-1 rounded-full py-1.5 pr-3 pl-1.5 text-sm font-medium text-zinc-300 transition hover:bg-white/5 hover:text-white"
          >
            <ChevronLeft className="size-5 shrink-0" />
            <span className="truncate">{backLabel ?? "Voltar"}</span>
          </Link>
        ) : (
          <Link to="/" aria-label="Replay — início">
            <Logo />
          </Link>
        )}
        <div data-slot="sponsor" className="h-9 w-24 shrink-0" aria-hidden />
      </div>
    </header>
  );
}
