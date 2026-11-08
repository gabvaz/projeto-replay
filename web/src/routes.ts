/** Paths públicos e de produto — use estes helpers em vez de strings soltas. */

export const paths = {
  home: "/",
  court: (key: string) => `/quadra/${encodeURIComponent(key)}`,
  courtQr: (key: string) => `/quadra/${encodeURIComponent(key)}/qr`,
  gallery: (key: string) => `/galeria/${encodeURIComponent(key)}`,
  replay: (id: string) => `/replay/${encodeURIComponent(id)}`,
  painel: "/painel",
  painelEntrar: "/painel/entrar",
  arena: "/arena",
  arenaEntrar: "/arena/entrar",
} as const;
