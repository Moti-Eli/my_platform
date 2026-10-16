/**
 * Full-screen route shell for the Staff tool. Thin — it renders the tool's
 * FullScreen view (the shell hosts; the tool implements).
 *
 * THE access boundary for this route: requireSession() is called HERE, as the
 * first statement. Staff is ADMIN-ONLY (manifest `requiresAdmin`), so this is ALSO
 * the per-route admin gate that flag documents: a non-admin is redirected away
 * server-side, before FullScreen (and its intent) can render. That is
 * defence-in-depth — the catalog already dims+locks the card, and RLS still gates
 * the underlying read row-by-row — but a route must never trust the UI lock alone.
 *
 * It DOES need identity — FullScreen calls runIntent, which needs a Ctx — so the
 * session's two ids go down as props, one level.
 */
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { FullScreen } from "@/tools/staff/views/FullScreen";

export default async function StaffToolPage() {
  const { userId, orgId, isAdmin } = await requireSession();
  if (!isAdmin) redirect("/catalog");
  return <FullScreen userId={userId} orgId={orgId} />;
}
