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
 *
 * It also reads the active org's NAME — display only, for the WhatsApp order
 * message ("הזמנה מ…") — exactly as the profile page does: through the same
 * RLS-scoped server client, never the admin client. A missing name is not an
 * error here; the message then just says "הזמנה:".
 */
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FullScreen } from "@/tools/orders/views/FullScreen";

export default async function OrdersToolPage() {
  const { userId, orgId, isAdmin } = await requireSession();
  if (!isAdmin) redirect("/catalog");

  let orgName = "";
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    const orgRes = await supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    if (!orgRes.error) orgName = (orgRes.data as { name: string } | null)?.name ?? "";
  }

  return <FullScreen userId={userId} orgId={orgId} orgName={orgName} />;
}
