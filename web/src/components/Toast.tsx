import { Sparkles } from "lucide-react";

type Props = { message: string | null; onClick?: () => void };

/** Pílula flutuante no topo; some sozinha (controlada pelo pai). */
export function Toast({ message, onClick }: Props) {
  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(4rem+env(safe-area-inset-top))] z-40 flex justify-center px-4">
      <button
        type="button"
        onClick={onClick}
        className="animate-rise-in pointer-events-auto inline-flex items-center gap-2 rounded-full bg-lime px-4 py-2 text-sm font-bold text-ink shadow-[0_12px_40px_-8px_color-mix(in_oklab,var(--color-lime)_60%,transparent)]"
        role="status"
      >
        <Sparkles className="size-4" />
        {message}
      </button>
    </div>
  );
}
