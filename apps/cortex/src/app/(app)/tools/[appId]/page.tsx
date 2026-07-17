// Dynamic route for stub apps — any registered stub (`/tools/<id>`) renders the
// generic placeholder screen, so adding a stub to the registry needs no new
// page. Real tools with their own static route (e.g. /tools/inventory) take
// precedence over this dynamic segment.
//
// THE access boundary for this route: requireSession() is called HERE, in this
// file. Already a server component, so it needed the guard added, not a split.
// A stub renders no tool data, so it needs protection but not identity — the
// session's result is deliberately not passed down.
import { requireSession } from "@/lib/session";
import { PlaceholderScreen } from "@/components/PlaceholderScreen";

export default async function ToolPlaceholderPage({
  params,
}: {
  params: Promise<{ appId: string }>;
}) {
  await requireSession();
  const { appId } = await params;
  return <PlaceholderScreen appId={appId} />;
}
