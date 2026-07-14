/**
 * Full-screen route shell for the Inventory tool. Thin — it just renders the
 * tool's FullScreen view (the shell hosts; the tool implements).
 */
import { FullScreen } from "@/tools/inventory/views/FullScreen";

export default function InventoryToolPage() {
  return <FullScreen />;
}
