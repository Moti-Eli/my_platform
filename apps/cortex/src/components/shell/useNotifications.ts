"use client";

/**
 * The urgency-inbox notifications store — the SINGLE seam a real backend slots
 * into (mirrors {@link useAiChat}). The component depends ONLY on the
 * {@link NotificationsStore} interface, so swapping this hook's body for a real
 * source — sub-apps emitting events through the core event bus, a subscriber that
 * turns them into notifications — needs NO change to the component.
 *
 * A notification is app-centric: it references an app by `appId` (resolved to
 * icon/name/route via the registry — never hard-coded), plus a title,
 * description, and timestamp.
 */
import { useCallback, useState } from "react";

export interface AppNotification {
  id: string;
  /** The app this belongs to — resolved to icon/name/route via the registry. */
  appId: string;
  /**
   * Display title. Demo rows carry an i18n key (resolved with `t()`, exactly like
   * a manifest's `name.key`); real notifications will carry already-built text,
   * which `t()` returns unchanged (key-not-found fallback).
   */
  title: string;
  /** Short description — same key-or-literal convention as {@link title}. */
  description: string;
  /** Epoch ms the notification arrived (shown as relative time). */
  timestamp: number;
}

/** The surface the screen consumes. A backend impl returns the same shape. */
export interface NotificationsStore {
  listNotifications(): AppNotification[];
  dismiss(id: string): void;
  clear(): void;
}

// DEV dummy data — replaced when sub-apps emit real notifications via the event
// bus. Titles/descriptions are i18n keys (see AppNotification.title). Timestamps
// are offsets from module load so the relative time reads plausibly.
const MINUTE = 60_000;
const NOW = Date.now();

const SEED_NOTIFICATIONS: AppNotification[] = [
  {
    id: "u1",
    appId: "inventory",
    title: "notifications.inventoryTitle",
    description: "notifications.inventoryDesc",
    timestamp: NOW - 8 * MINUTE,
  },
  {
    id: "u2",
    appId: "calendar",
    title: "notifications.calendarTitle",
    description: "notifications.calendarDesc",
    timestamp: NOW - 3 * MINUTE,
  },
  {
    id: "u3",
    appId: "expenses",
    title: "notifications.expensesTitle",
    description: "notifications.expensesDesc",
    timestamp: NOW - 45 * MINUTE,
  },
  {
    id: "u4",
    appId: "tasks",
    title: "notifications.tasksTitle",
    description: "notifications.tasksDesc",
    timestamp: NOW - 120 * MINUTE,
  },
  {
    id: "u5",
    appId: "contacts",
    title: "notifications.contactsTitle",
    description: "notifications.contactsDesc",
    timestamp: NOW - 25 * MINUTE,
  },
];

export function useNotifications(): NotificationsStore {
  const [items, setItems] = useState<AppNotification[]>(SEED_NOTIFICATIONS);

  const listNotifications = useCallback(() => items, [items]);
  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
  }, []);
  const clear = useCallback(() => setItems([]), []);

  return { listNotifications, dismiss, clear };
}
