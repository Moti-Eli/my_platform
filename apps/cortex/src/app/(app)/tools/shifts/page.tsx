/**
 * Full-screen route shell for the Shifts tool. Thin — it just renders the tool's
 * FullScreen view (the shell hosts; the tool implements).
 *
 * THE access boundary for this route: requireSession() is called HERE, as the
 * first statement. Stage-1 screens are ADMIN-ONLY (manifest `requiresAdmin`),
 * so a non-admin is redirected to the catalog server-side, before FullScreen can
 * render. Defence-in-depth: the catalog already locks the card, and RLS requires
 * `shifts.manage` (admins only today) for every write.
 */
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { FullScreen } from "@/tools/shifts/views/FullScreen";

export default async function ShiftsToolPage() {
  const { userId, orgId, isAdmin } = await requireSession();
  if (!isAdmin) redirect("/catalog");
  return <FullScreen userId={userId} orgId={orgId} />;
}
