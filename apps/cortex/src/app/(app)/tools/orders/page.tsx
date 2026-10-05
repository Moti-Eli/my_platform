/**
 * Full-screen route shell for the Orders tool. Thin — it just renders the tool's
 * FullScreen view (the shell hosts; the tool implements).
 *
 * THE access boundary for this route: requireSession() is called HERE, as the
 * first statement. Orders is ADMIN-ONLY today (manifest `requiresAdmin`, which
 * mirrors migration 20261005000001's `orders.access` gate that only admins
 * currently pass), so a non-admin is redirected away server-side, before
 * FullScreen can render. Defence-in-depth — the catalog already locks the card,
 * and RLS still gates every row — but a route must never trust the UI lock alone.
 */
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { FullScreen } from "@/tools/orders/views/FullScreen";

export default async function OrdersToolPage() {
  const { userId, orgId, isAdmin } = await requireSession();
  if (!isAdmin) redirect("/catalog");
  return <FullScreen userId={userId} orgId={orgId} />;
}
