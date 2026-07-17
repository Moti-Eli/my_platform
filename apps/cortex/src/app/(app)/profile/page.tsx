/**
 * Server wrapper. THE access boundary for this route: requireSession() is called
 * HERE, in this file, not in a layout and not in the proxy. The body below is the
 * original client component, moved verbatim to ./ProfileView.tsx.
 *
 * This route needs protection but not identity, so the session is required and
 * its result deliberately not passed down — nothing here reads userId or orgId.
 */
import { requireSession } from "@/lib/session";
import { ProfileView } from "./ProfileView";

export default async function ProfilePage() {
  await requireSession();
  return <ProfileView />;
}
