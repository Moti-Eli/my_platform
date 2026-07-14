/**
 * A calm, centered empty state — the recurring "nothing here yet" placeholder
 * used across the shell screens. Purely presentational.
 */
import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-card px-6 py-14 text-center shadow-soft">
      {icon ? (
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-screen text-muted">
          {icon}
        </div>
      ) : null}
      <p className="text-base font-semibold text-ink">{title}</p>
      {hint ? <p className="max-w-[24ch] text-sm text-muted">{hint}</p> : null}
    </div>
  );
}
