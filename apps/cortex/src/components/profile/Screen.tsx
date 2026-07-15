"use client";

/**
 * A full-bleed screen frame shared by the profile, settings and placeholder
 * screens: a FIXED top bar that never scrolls, above a body that scrolls
 * beneath it. Lives inside the shell column (below the fixed TabBar) — the shell
 * skips its own header/chips for these routes (see AppShell `fullBleed`).
 *
 * The top bar owns placement so every screen is consistent: it is laid out
 * LTR-physical (`dir="ltr"`) so the back control is ALWAYS on the left and points
 * left — in both Hebrew and English, never mirrored per-locale. An optional
 * `right` control (e.g. the profile hamburger) sits on the right, with `center`
 * (title / avatar) centered between them. The scrolling body keeps the app's own
 * direction (RTL for Hebrew).
 */
import type { ReactNode } from "react";
import { BackButton } from "./BackButton";

export function Screen({
  center,
  right,
  children,
}: {
  center?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        dir="ltr"
        className="flex shrink-0 items-center gap-xs border-b border-hairline bg-screen px-md pb-sm pt-xs"
      >
        <BackButton />
        <div className="flex min-w-0 flex-1 items-center justify-center gap-xs text-center">
          {center}
        </div>
        {/* Fixed-width right zone (matches the back button) keeps `center` truly
            centered whether or not a right control is present. */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center">{right}</div>
      </div>
      <div className="flex-1 overflow-y-auto px-md pb-xl">{children}</div>
    </div>
  );
}
