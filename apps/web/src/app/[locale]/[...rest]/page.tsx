import { notFound } from "next/navigation";

/**
 * Catch-all for unmatched paths under a locale. Next renders the DEFAULT (non-
 * localized) 404 for routes that don't go through the [locale] segment; this
 * funnels any unknown in-locale path through `notFound()` so our localized,
 * themed `[locale]/not-found.tsx` is shown instead.
 */
export default function CatchAllNotFound() {
  notFound();
}
