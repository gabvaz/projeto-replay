type Variant = "negativa" | "positiva";

type Props = {
  className?: string;
  /** Esconde a assinatura e mostra só o símbolo. */
  iconOnly?: boolean;
  /** negativa = fundo escuro; positiva = papel/branco. */
  variant?: Variant;
};

// /marca/* — assets estáticos. /brand/* é worker-first (logo da arena no R2).
const SIGN = {
  negativa: "/marca/loop-assinatura-negativa.svg",
  positiva: "/marca/loop-assinatura-positiva.svg",
} as const;

const SYMBOL = {
  negativa: "/marca/loop-simbolo-negativa.svg",
  positiva: "/marca/loop-simbolo-positiva.svg",
} as const;

export function LogoIcon({ className = "size-8", variant = "negativa" }: { className?: string; variant?: Variant }) {
  return <img src={SYMBOL[variant]} alt="" className={`${className} object-contain`} />;
}

export function Logo({ className = "h-8", iconOnly = false, variant = "negativa" }: Props) {
  if (iconOnly) return <LogoIcon className={className} variant={variant} />;
  return <img src={SIGN[variant]} alt="loop" className={`w-auto object-contain ${className}`} />;
}

/** Ponto REC da marca. Use no fim de títulos — não redigite a assinatura. */
export function RecDot({ className = "" }: { className?: string }) {
  return <span className={`rec-dot ${className}`.trim()} aria-hidden />;
}
