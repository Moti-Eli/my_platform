/**
 * Tool UI registry — maps a registered tool id to its shell-facing view bits
 * (the dashboard card component + its full-screen route). The shell reads the
 * *logic* side of a tool from the core registry (manifest/intents); this is the
 * *view* side. Add a tool's row here to make it renderable on Home.
 */
import type { ComponentType } from "react";
import { DashboardCard as InventoryDashboardCard } from "./inventory/views/DashboardCard";

export interface ToolUI {
  /** Compact summary card shown on Home. */
  DashboardCard: ComponentType;
  /** Full-screen route (post-locale path in the cortex app). */
  route: string;
}

export const TOOL_VIEWS: Record<string, ToolUI> = {
  inventory: { DashboardCard: InventoryDashboardCard, route: "/tools/inventory" },
};
