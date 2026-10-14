export function GallerySkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-label="Carregando replays" role="status">
      <div className="skeleton h-40 rounded-3xl" />
      <div className="skeleton h-6 w-24 rounded-md" />
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-5">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton aspect-[9/16] rounded-xl sm:rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

export function PlayerSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Carregando replay">
      <div className="skeleton mx-auto aspect-[9/16] max-h-[78svh] w-full max-w-[44svh] rounded-3xl" />
      <div className="skeleton h-5 w-48 rounded-md" />
    </div>
  );
}
