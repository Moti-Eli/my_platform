"use client";

/**
 * A full-bleed screen frame shared by the profile, settings and placeholder
 * screens: a FIXED top bar that never scrolls, above a body that scrolls
 * beneath it. Lives inside the shell column (below the fixed TabBar) — the shell
 * skips its own header/chips for these routes (see AppShell `fullBleed`).
 */
import type { ReactNode } from "react";

export function Screen({ bar, children }: { bar: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-hairline bg-screen px-4 pb-2.5 pt-2">{bar}</div>
      <div className="flex-1 overflow-y-auto px-4 pb-8">{children}</div>
    </div>
  );
}
