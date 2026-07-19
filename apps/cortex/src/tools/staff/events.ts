/**
 * Staff — events (Standard §5).
 *
 * Emits: nothing yet. Staff is READ-ONLY this step — it observes existing platform
 * tables (memberships/roles/users) and makes no changes, so there is nothing to
 * announce. Listens: nothing yet.
 */
import type { AnyListener } from "@platform/cortex-core";

export const listeners: AnyListener[] = [];
