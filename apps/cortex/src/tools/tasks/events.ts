/**
 * Tasks — events (Standard §5).
 *
 * Emits (fired from logic.ts via the event-bus; each persists to the `events`
 * table before any listener runs):
 *   'tasks.created'   → { id, title }
 *   'tasks.completed' → { id }
 *
 * Listens: nothing yet. (A future 'tasks.completed' listener elsewhere could,
 * say, notify a manager — the emitting tool stays decoupled from whoever listens.)
 */
import type { AnyListener } from "@platform/cortex-core";

export const listeners: AnyListener[] = [];
