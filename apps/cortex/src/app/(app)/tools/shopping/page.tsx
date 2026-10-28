/**
 * Full-screen route shell for the Shopping tool. Thin — it just renders the
 * tool's FullScreen view (the shell hosts; the tool implements).
 *
 * THE access boundary for this route: requireSession() is called HERE, as the
 * first statement. Open to every member (no requiresAdmin): RLS on the shopping
 * tables gates every read and write on membership in the list's org.
 */
import { requireSession } from "@/lib/session";
import { FullScreen } from "@/tools/shopping/views/FullScreen";

export default async function ShoppingToolPage() {
  const { userId, orgId } = await requireSession();
  return <FullScreen userId={userId} orgId={orgId} />;
}
