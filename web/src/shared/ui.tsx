import { Loader2, X } from "lucide-react";
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";

export const inputCls =
  "w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-lime/60 disabled:opacity-50";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-4xl leading-none font-black uppercase italic">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  actions,
  children,
  className = "",
  pad = true,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section className={`rounded-2xl border border-line bg-surface ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
          {actions}
        </header>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

type Tone = "lime" | "red" | "amber" | "zinc" | "blue";

const TONE: Record<Tone, string> = {
  lime: "bg-lime/15 text-lime ring-lime/30",
  red: "bg-red-500/15 text-red-300 ring-red-500/30",
  amber: "bg-amber-400/15 text-amber-300 ring-amber-400/30",
  zinc: "bg-white/5 text-zinc-300 ring-white/10",
  blue: "bg-sky-400/15 text-sky-300 ring-sky-400/30",
};

export function Badge({ tone = "zinc", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

export function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "lime" | "red" | "amber";
}) {
  const color = tone === "lime" ? "text-lime" : tone === "red" ? "text-red-300" : tone === "amber" ? "text-amber-300" : "text-white";
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{label}</p>
      <p className={`font-display mt-1 text-4xl leading-none font-extrabold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="mt-1.5 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "subtle" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
};

/** Classes do botão, pra usar em `<a>` sem aninhar `<button>`. */
export function buttonCls(variant: ButtonProps["variant"] = "subtle", size: ButtonProps["size"] = "md") {
  const v = {
    primary: "bg-lime text-ink hover:brightness-110 font-bold",
    subtle: "border border-line bg-surface-2 text-zinc-100 hover:border-zinc-600",
    ghost: "text-zinc-300 hover:bg-white/5 hover:text-white",
    danger: "border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20",
  }[variant];
  const s = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm";
  return `inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition disabled:opacity-50 ${v} ${s}`;
}

export function Button({ variant = "subtle", size = "md", loading, className = "", children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`${buttonCls(variant, size)} ${className}`}
      {...rest}
    >
      {loading && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-zinc-400">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
    </label>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="animate-rise-in flex max-h-[90svh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-2xl sm:max-w-lg sm:rounded-2xl"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-display text-2xl font-black uppercase italic">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-lg p-1 text-zinc-400 hover:bg-white/5 hover:text-white">
            <X className="size-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">{footer}</footer>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <nav className="no-scrollbar -mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4" aria-label="Seções">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
            t.id === value ? "border-lime text-white" : "border-transparent text-zinc-500 hover:text-zinc-200"
          }`}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-xs text-zinc-500 tabular-nums">{t.count}</span>}
        </button>
      ))}
    </nav>
  );
}

export function StatusDot({ online }: { online: boolean }) {
  return (
    <span className={`relative inline-flex size-2.5 rounded-full ${online ? "bg-lime" : "bg-red-400"}`}>
      {online && <span className="animate-pulse-dot absolute inset-0 rounded-full bg-lime" />}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-10 text-center text-sm text-zinc-500">{children}</p>;
}

export function Loading() {
  return (
    <div className="flex justify-center py-16 text-zinc-500" role="status" aria-label="Carregando">
      <Loader2 className="size-6 animate-spin" />
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return children ? (
    <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{children}</p>
  ) : null;
}

/** Wrapper de tabela com scroll horizontal no celular. */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-px overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm [&_td]:px-4 [&_td]:py-2.5 [&_th]:px-4 [&_th]:py-2 [&_th]:text-xs [&_th]:font-semibold [&_th]:tracking-wide [&_th]:text-zinc-500 [&_th]:uppercase [&_tbody_tr]:border-t [&_tbody_tr]:border-line [&_tbody_tr:hover]:bg-white/[0.02]">
        {children}
      </table>
    </div>
  );
}
