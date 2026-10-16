/**
 * Full-screen route shell for the Questionnaire tool. Thin — it just renders the
 * tool's FullScreen view (the shell hosts; the tool implements).
 *
 * THE access boundary for this route: requireSession() is called HERE, in this
 * file. It DOES need identity — FullScreen is a tool view (ToolViewProps) and the
 * shell hands every view the session's two ids — so they go down as props, one level.
 *
 * NOT admin-gated: the questionnaire is answered by the candidate (a plain member of
 * their own child org), so — unlike staff/candidates — there is no isAdmin check or
 * redirect here; membership + candidate_answers' RLS are the whole boundary.
 */
import { requireSession } from "@/lib/session";
import { FullScreen } from "@/tools/questionnaire/views/FullScreen";

export default async function QuestionnaireToolPage() {
  const { userId, orgId } = await requireSession();
  return <FullScreen userId={userId} orgId={orgId} />;
}
