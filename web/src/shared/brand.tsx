import type { CSSProperties, ReactNode } from "react";

export type Brand = { name: string; color: string | null; logo_url: string | null };

/** Troca o acento (`lime`) de tudo que estiver dentro pela cor da arena. */
export function brandStyle(color: string | null | undefined): CSSProperties | undefined {
  if (!color) return undefined;
  return {
    "--color-lime": color,
    "--color-lime-dim": `color-mix(in oklab, ${color} 78%, black)`,
  } as CSSProperties;
}

export function BrandScope({
  color,
  className,
  children,
}: {
  color: string | null | undefined;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div style={brandStyle(color)} className={className}>
      {children}
    </div>
  );
}

/** Logo da arena num quadrado escuro (aceita PNG transparente ou foto). */
export function BrandLogo({ brand, className = "size-12" }: { brand: Brand | null | undefined; className?: string }) {
  if (!brand?.logo_url) return null;
  return (
    <img
      src={brand.logo_url}
      alt={brand.name}
      className={`${className} shrink-0 rounded-xl bg-white/5 object-contain ring-1 ring-white/10`}
    />
  );
}
