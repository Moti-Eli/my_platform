/**
 * The Home "app tabs" row — a horizontal strip of pinned-tool tabs. Presentational:
 * it receives resolved tabs (label already translated) and links to each tool's
 * full screen. While no tools are loaded it shows inert skeleton pills.
 */
import Link from "next/link";

export interface ToolTab {
  id: string;
  label: string;
  route: string;
}

export function AppTabsRow({ tools }: { tools: ToolTab[] }) {
  if (tools.length === 0) {
    return (
      <div className="flex gap-2 overflow-x-auto pb-1" aria-hidden>
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

  return (
    <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
      {tools.map((tab) => (
        <Link
          key={tab.id}
          href={tab.route}
          className="shrink-0 rounded-pill bg-card px-4 py-2 text-sm font-semibold text-ink shadow-soft transition active:scale-95"
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
