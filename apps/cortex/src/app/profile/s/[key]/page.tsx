/**
 * Server wrapper. THE access boundary for this route: requireSession() is called
 * HERE, in this file, not in a layout and not in the proxy. The body below is the
 * original client component, moved verbatim to ./ProfileSectionView.tsx.
 *
 * The `[key]` segment is NOT threaded through as a prop: the body reads it with
 * the `useParams` client hook, exactly as it did before. Passing it would have
 * been a change, not a move.
 *
 * This route needs protection but not identity — nothing here reads userId or orgId.
 */
import { requireSession } from "@/lib/session";
import { ProfileSectionView } from "./ProfileSectionView";

export default async function ProfileSectionPage() {
  await requireSession();
  return <ProfileSectionView />;
}
