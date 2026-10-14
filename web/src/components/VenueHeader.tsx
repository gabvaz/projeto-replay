import { Link } from "react-router";

type Props = {
  venueName?: string;
  courtName?: string;
  courtKey?: string;
};

/** Topo com arena/quadra. O slot à direita fica reservado pro logo da arena/patrocinador. */
export function VenueHeader({ venueName, courtName, courtKey }: Props) {
  return (
    <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-xs uppercase tracking-wider text-zinc-400">
            {venueName ?? "Replay"}
          </p>
          {courtName &&
            (courtKey ? (
              <Link to={`/q/${courtKey}`} className="block truncate text-lg font-semibold">
                {courtName}
              </Link>
            ) : (
              <p className="truncate text-lg font-semibold">{courtName}</p>
            ))}
        </div>
        <div data-slot="sponsor" className="h-10 w-24 shrink-0" aria-hidden />
      </div>
    </header>
  );
}
