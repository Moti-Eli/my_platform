/**
 * Full-screen route shell for the Shifts tool. Thin — it just renders the tool's
 * FullScreen view (the shell hosts; the tool implements).
 *
 * THE access boundary for this route: requireSession() is called HERE, as the
 * first statement. Since stage 2 the tool is open to every org member, and this
 * page decides WHAT the member sees:
 *
 *   isAdmin    → the manager screens (from the session).
 *   isEmployee → the user has a shift_employees row in the active org — read
 *                through the SAME RLS-scoped server client the orders page uses
 *                for the org name (never the admin client; the table is readable
 *                by every org member). A query error fails CLOSED (false).
 *   neither    → FullScreen shows "you're not in the shifts tool".
 *
 * Both flags only pick the UI. RLS is the boundary: every write on a shifts
 * table requires `shifts.manage` (admins only today).
 */
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FullScreen } from "@/tools/shifts/views/FullScreen";

export default async function ShiftsToolPage() {
  const { userId, orgId, isAdmin } = await requireSession();

  let isEmployee = false;
  if (!isAdmin) {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      const res = await supabase
        .from("shift_employees")
        .select("id")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .limit(1);
      if (!res.error) isEmployee = (res.data ?? []).length > 0;
    }
  }

  return <FullScreen userId={userId} orgId={orgId} isAdmin={isAdmin} isEmployee={isEmployee} />;
}
