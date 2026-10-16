/**
 * Route-level loading UI for every screen in the `(app)` group.
 *
 * Next renders this the instant a navigation starts, while the target page's
 * server work (requireSession, then the tool's first react-query fetch) is still
 * running — so a tap paints a skeleton immediately instead of freezing on the old
 * screen.
 *
 * BODY ONLY. The `(app)` layout already provides the chrome (header, app-tabs row,
 * bottom TabBar), and it is NOT replaced during navigation — so this file must
 * render just the screen body, exactly like a page does. Rendering any header or
 * tab bar here would double the chrome.
 *
 * A SERVER COMPONENT, deliberately: a static skeleton needs no state, no effects
 * and no i18n lookup, so it ships zero client JS and can stream in first.
 *
 * `motion-safe:` (matching the dashboard-card skeletons) means reduced-motion
 * users get a static, still-visible skeleton rather than a pulse.
 */

/** Identical to the tools' dashboard-card skeletons — one visual language. */
const SKELETON = "rounded-md bg-hairline motion-safe:animate-pulse";

/** Placeholder cards drawn while the real screen resolves. */
const CARDS = [0, 1, 2];

/** Rows drawn inside each placeholder card. */
const ROWS = [0, 1, 2];

export default function AppGroupLoading() {
  return (
    <section aria-busy="true" aria-label="loading" className="flex flex-col gap-md">
      {CARDS.map((card) => (
        <div key={card} className="rounded-lg bg-card p-md">
          {/* Card head: icon disc + title, mirroring a tool's DashboardCard. */}
          <div className="mb-sm flex items-center gap-xs">
            <span className="h-9 w-9 rounded-full bg-hairline motion-safe:animate-pulse" />
            <span className={`h-4 w-24 ${SKELETON}`} />
          </div>

          <ul className="flex flex-col divide-y divide-hairline">
            {ROWS.map((row) => (
              <li key={row} className="flex items-center justify-between py-sm">
                <span className={`h-3 w-1/3 ${SKELETON}`} />
                <span className={`h-3 w-8 ${SKELETON}`} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
