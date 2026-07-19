/**
 * Server wrapper. THE access boundary for this route: requireSession() is called
 * HERE, in this file, not in a layout and not in the proxy. The body below is the
 * original client component, in ./CatalogView.tsx.
 *
 * Identity travels DOWN AS A PROP (never a context — session.ts's header explains
 * why): the catalog dims+locks `requiresAdmin` tools for non-admins, so it needs
 * the caller's admin status. `isAdmin` from the guard is the only thing passed.
 */
import { requireSession } from "@/lib/session";
import { CatalogView } from "./CatalogView";

export default async function CatalogPage() {
  const { isAdmin } = await requireSession();
  return <CatalogView isAdmin={isAdmin} />;
}
