type Props = {
  className?: string;
  /** Esconde o texto e mostra só o ícone. */
  iconOnly?: boolean;
};

export function LogoIcon({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--color-lime)" />
      <g
        transform="translate(4 4)"
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M10 8.5v7l5.5-3.5z" fill="var(--color-ink)" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

export function Logo({ className = "", iconOnly = false }: Props) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoIcon className="size-7" />
      {!iconOnly && (
        <span className="font-display text-2xl leading-none font-black tracking-tight uppercase italic">
          Replay
        </span>
      )}
    </span>
  );
}
