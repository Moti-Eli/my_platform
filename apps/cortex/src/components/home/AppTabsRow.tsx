/**
 * Placeholder for the Home "app tabs" row — the horizontal strip that will let
 * you switch between pinned tools. For now it renders inert skeleton pills (no
 * tools exist yet). Purely presentational.
 */
export function AppTabsRow() {
  return (
    <div
      className="flex gap-2 overflow-x-auto pb-1"
      aria-label="לשוניות כלים"
      role="tablist"
      aria-hidden
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-9 w-24 shrink-0 rounded-pill bg-card shadow-soft"
          style={{ opacity: 1 - i * 0.18 }}
        />
      ))}
    </div>
  );
}
