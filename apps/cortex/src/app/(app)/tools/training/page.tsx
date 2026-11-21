/**
 * Full-screen route shell for the Training tool. Thin — it just renders the
 * tool's FullScreen view (the shell hosts; the tool implements).
 *
 * THE access boundary for this route: requireSession() is called HERE, as the
 * first statement. Open to every member (no requiresAdmin): RLS on the training
 * tables gates every read and write on membership in the plan's org.
 */
import { requireSession } from "@/lib/session";
import { FullScreen } from "@/tools/training/views/FullScreen";

export default async function TrainingToolPage() {
  const { userId, orgId } = await requireSession();
  return <FullScreen userId={userId} orgId={orgId} />;
}
