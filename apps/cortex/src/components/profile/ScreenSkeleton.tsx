/**
 * Loading skeleton for the FULL-BLEED screens (profile / settings) — the shared
 * body behind their route-level loading.tsx files.
 *
 * CRITICAL — renders its OWN fixed top bar. These routes are `fullBleed` in
 * AppShell (pathname check there): the shell renders NO header for them and the
 * screen supplies its own — the OPPOSITE contract from app/(app)/loading.tsx,
 * which is body-only. The structure mirrors @/components/profile/Screen exactly
 * (same outer column, same top-bar class string incl. dir="ltr", a placeholder
 * where BackButton sits, and the same fixed-width right spacer that keeps the
 * center truly centered), so skeleton → screen never reflows.
 *
 * A SERVER COMPONENT, deliberately: a static skeleton needs no state, no
 * effects and no i18n lookup, so it ships zero client JS and can stream first.
 *
 * `motion-safe:` (matching app/(app)/loading.tsx — one visual language) means
 * reduced-motion users get a static, still-visible skeleton, not a pulse.
 */

/** Identical to app/(app)/loading.tsx's skeleton recipe — one visual language. */
const SKELETON = "rounded-md bg-hairline motion-safe:animate-pulse";

/** Placeholder sections drawn while the real screen resolves. */
const SECTIONS = [0, 1, 2];

/** Rows drawn inside each placeholder section (mirroring ListSection/ListRow). */
const ROWS = [0, 1, 2];

export function ScreenSkeleton() {
  return (
    <div aria-busy="true" className="flex min-h-0 flex-1 flex-col">
      {/* The fixed top bar — Screen's exact bar, with placeholders: a disc where
          BackButton sits, a centered title bar, and Screen's fixed-width right
          spacer. dir="ltr" as in Screen: the back control is physically left in
          both locales. */}
      <div
        dir="ltr"
        className="flex shrink-0 items-center gap-xs border-b border-hairline bg-screen px-md pb-sm pt-xs"
      >
        <span className="h-10 w-10 shrink-0 rounded-full bg-hairline motion-safe:animate-pulse" />
        <div className="flex min-w-0 flex-1 items-center justify-center gap-xs text-center">
          <span className={`h-4 w-24 ${SKELETON}`} />
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center" />
      </div>

      {/* The body — sections shaped like ListSection (small title bar) holding
          ListRow-shaped rows (icon disc + flexible label bar). */}
      <div className="flex-1 px-md pb-xl">
        {SECTIONS.map((section) => (
          <section key={section} className="mt-lg first:mt-md">
            <div className="px-2xs pb-2xs">
              <span className={`block h-3 w-20 ${SKELETON}`} />
            </div>
            {ROWS.map((row) => (
              <div key={row} className="flex items-center gap-sm px-2xs py-xs">
                <span className="h-9 w-9 shrink-0 rounded-full bg-hairline motion-safe:animate-pulse" />
                <span className={`h-4 flex-1 ${SKELETON}`} />
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
