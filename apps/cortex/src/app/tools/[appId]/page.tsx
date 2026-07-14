// Dynamic route for stub apps — any registered stub (`/tools/<id>`) renders the
// generic placeholder screen, so adding a stub to the registry needs no new
// page. Real tools with their own static route (e.g. /tools/inventory) take
// precedence over this dynamic segment.
import { PlaceholderScreen } from "@/components/PlaceholderScreen";

export default async function ToolPlaceholderPage({
  params,
}: {
  params: Promise<{ appId: string }>;
}) {
  const { appId } = await params;
  return <PlaceholderScreen appId={appId} />;
}
