/**
 * Tool UI registry — maps a registered tool id to its shell-facing view bits
 * (the dashboard card component + its full-screen route). The shell reads the
 * *logic* side of a tool from the core registry (manifest/intents); this is the
 * *view* side. Add a tool's row here to make it renderable on Home.
 */
import type { ComponentType } from "react";
import { DashboardCard as InventoryDashboardCard } from "./inventory/views/DashboardCard";
import { DashboardCard as TasksDashboardCard } from "./tasks/views/DashboardCard";
import { DashboardCard as StaffDashboardCard } from "./staff/views/DashboardCard";

/**
 * The identity every tool view is handed by the shell.
 *
 * A tool NEVER resolves identity itself (Standard §7: the shell resolves it up
 * front). These two ids arrive as props from the server page that called
 * `requireSession()`, and the view turns them into a `Ctx` with `buildCtx`. The
 * card is typed to REQUIRE them so a tool view cannot be rendered without a guard
 * having run above it — the type is what makes that structural rather than a
 * convention someone can forget.
 */
export interface ToolViewProps {
  userId: string;
  orgId: string;
}

export interface ToolUI {
  /** Compact summary card shown on Home. */
  DashboardCard: ComponentType<ToolViewProps>;
  /** Full-screen route (post-locale path in the cortex app). */
  route: string;
}

export const TOOL_VIEWS: Record<string, ToolUI> = {
  inventory: { DashboardCard: InventoryDashboardCard, route: "/tools/inventory" },
  tasks: { DashboardCard: TasksDashboardCard, route: "/tools/tasks" },
  staff: { DashboardCard: StaffDashboardCard, route: "/tools/staff" },
};
