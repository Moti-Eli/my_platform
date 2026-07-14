/**
 * Home — an EMPTY SHELL. An app-tabs row placeholder at the top and an empty
 * dashboard area with a "nothing pinned yet" state. No real cards yet; content
 * is spec'd next.
 */
import { AppTabsRow } from "@/components/home/AppTabsRow";
import { EmptyState } from "@/components/EmptyState";
import { PinIcon } from "@/components/icons";

export default function HomePage() {
  return (
    <>
      <AppTabsRow />

      <section aria-label="לוח מחוונים" className="flex flex-1 flex-col">
        <EmptyState
          icon={<PinIcon />}
          title="עדיין אין כלים מוצמדים"
          hint="כלים שתצמיד יופיעו כאן על לוח המחוונים."
        />
      </section>
    </>
  );
}
