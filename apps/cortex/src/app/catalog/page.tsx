/**
 * "כל הכלים" (catalog) — placeholder empty screen (slot 2). Real tool catalog
 * comes later.
 */
import { EmptyState } from "@/components/EmptyState";
import { GridIcon } from "@/components/icons";

export default function CatalogPage() {
  return (
    <>
      <h1 className="px-1 text-xl font-bold text-ink">כל הכלים</h1>
      <section className="flex flex-1 flex-col">
        <EmptyState
          icon={<GridIcon />}
          title="הקטלוג עדיין ריק"
          hint="כאן יופיעו כל הכלים הזמינים להתקנה והפעלה."
        />
      </section>
    </>
  );
}
