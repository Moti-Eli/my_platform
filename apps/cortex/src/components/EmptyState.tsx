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
    <div className="flex flex-col items-center justify-center gap-sm rounded-xl bg-card px-lg py-2xl text-center shadow-soft">
      {icon ? (
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-screen text-muted">
          {icon}
        </div>
      ) : null}
      <p className="type-heading text-ink">{title}</p>
      {hint ? <p className="max-w-[24ch] type-label text-muted">{hint}</p> : null}
    </div>
  );
}
