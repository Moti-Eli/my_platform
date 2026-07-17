/**
 * Server wrapper for Home. THE access boundary for this route: requireSession()
 * is called HERE, in this file, not in a layout and not in the proxy. The body is
 * the original client component, moved verbatim to ./HomeView.tsx.
 *
 * This route DOES need identity: it renders each installed tool's DashboardCard,
 * and those cards call runIntent, which needs a Ctx. The session's two ids go down
 * as PROPS, one level — never a context, which would be somewhere identity could
 * be read without a guard having run above it.
 */
import { requireSession } from "@/lib/session";
import { HomeView } from "./HomeView";

export default async function HomePage() {
  const { userId, orgId } = await requireSession();
  return <HomeView userId={userId} orgId={orgId} />;
}
