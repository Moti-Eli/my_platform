/**
 * Full-screen route shell for the Notes tool. Thin — it just renders the tool's
 * FullScreen view (the shell hosts; the tool implements).
 *
 * THE access boundary for this route: requireSession() is called HERE, in this
 * file. Already a server component, so it needed the guard added, not a split.
 * It DOES need identity — FullScreen calls runIntent, which needs a Ctx — so the
 * session's two ids go down as props, one level.
 *
 * NOT admin-gated: notes are for everyone, so — unlike staff — there is no isAdmin
 * check or redirect here; membership + RLS are the whole boundary.
 */
import { requireSession } from "@/lib/session";
import { FullScreen } from "@/tools/notes/views/FullScreen";

export default async function NotesToolPage() {
  const { userId, orgId } = await requireSession();
  return <FullScreen userId={userId} orgId={orgId} />;
}
