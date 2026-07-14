/**
 * Translation dictionaries (he default, en full parallel). The `he` object
 * defines the canonical shape; `en` must match it (typed as {@link Messages}).
 * Keys are addressed by dot-path (e.g. `t("home.emptyTitle")`), type-checked via
 * {@link MessageKey}.
 */
import type { Locale } from "./config";
// Tool dictionaries are supplied by each tool and merged here under the tool's
// namespace (Standard §8: central i18n consumes tool keys). Keys become
// type-checked (e.g. t("inventory.name")).
import inventoryHe from "@/tools/inventory/i18n/he.json";
import inventoryEn from "@/tools/inventory/i18n/en.json";

const he = {
  common: {
    close: "סגירה",
    search: "חיפוש",
    searchPlaceholder: "חיפוש...",
    send: "שליחה",
    mainNav: "ניווט ראשי",
    settings: "הגדרות",
    back: "חזרה",
    savedLocally: "ההעדפות נשמרות במכשיר זה",
  },
  tabs: {
    home: "בית",
    catalog: "כל הכלים",
    ai: "עוזר ה-AI",
    comms: "צ'אט",
    profile: "פרופיל",
  },
  ai: {
    title: "מה נעשה?",
    placeholder: "כתוב מה תרצה לעשות…",
    notConnected: "העוזר עדיין לא מחובר למנוע — זהו שלד בלבד.",
  },
  urgency: {
    title: "מה דחוף היום",
    emptyTitle: "אין התראות דחופות כרגע",
    emptyHint: "דברים שדורשים תשומת לב יופיעו כאן.",
  },
  notifications: {
    title: "התראות",
    empty: "אין התראות עדיין",
  },
  home: {
    appTabsLabel: "לשוניות כלים",
    dashboardLabel: "לוח מחוונים",
    emptyTitle: "עדיין אין כלים מוצמדים",
    emptyHint: "כלים שתצמיד יופיעו כאן על לוח המחוונים.",
  },
  catalog: {
    title: "כל הכלים",
    emptyTitle: "הקטלוג עדיין ריק",
    emptyHint: "כאן יופיעו כל הכלים הזמינים להתקנה והפעלה.",
  },
  comms: {
    title: "צ'אט",
    emptyTitle: "אין שיחות עדיין",
    emptyHint: "כאן תתנהל התקשורת עם הצוות והכלים.",
  },
  profile: {
    title: "פרופיל",
    identityCore: "ליבת זהות",
    identityHint: "כאן תופיע ליבת הזהות שלך — פרטים, הרשאות והעדפות. שלד בלבד בשלב זה.",
  },
  settings: {
    title: "הגדרות",
    language: "שפה",
    appearance: "נראות",
    version: "גרסה",
    languageHe: "עברית",
    languageEn: "English",
    themeLight: "בהיר",
    themeDark: "כהה",
  },
  inventory: inventoryHe,
} as const;

/** The canonical message shape (derived from `he`). */
export type Messages = {
  [K in keyof typeof he]: { [P in keyof (typeof he)[K]]: string };
};

const en: Messages = {
  common: {
    close: "Close",
    search: "Search",
    searchPlaceholder: "Search...",
    send: "Send",
    mainNav: "Main navigation",
    settings: "Settings",
    back: "Back",
    savedLocally: "Preferences are saved on this device",
  },
  tabs: {
    home: "Home",
    catalog: "All tools",
    ai: "AI assistant",
    comms: "Chat",
    profile: "Profile",
  },
  ai: {
    title: "What shall we do?",
    placeholder: "Type what you'd like to do…",
    notConnected: "The assistant isn't connected to an engine yet — this is a shell only.",
  },
  urgency: {
    title: "What's urgent today",
    emptyTitle: "Nothing urgent right now",
    emptyHint: "Things that need your attention will appear here.",
  },
  notifications: {
    title: "Notifications",
    empty: "No notifications yet",
  },
  home: {
    appTabsLabel: "Tool tabs",
    dashboardLabel: "Dashboard",
    emptyTitle: "Nothing pinned yet",
    emptyHint: "Tools you pin will appear here on the dashboard.",
  },
  catalog: {
    title: "All tools",
    emptyTitle: "The catalog is empty",
    emptyHint: "Every tool available to install and run will appear here.",
  },
  comms: {
    title: "Chat",
    emptyTitle: "No conversations yet",
    emptyHint: "Communication with your team and tools will happen here.",
  },
  profile: {
    title: "Profile",
    identityCore: "Identity Core",
    identityHint:
      "Your identity core — details, permissions and preferences — will appear here. A shell for now.",
  },
  settings: {
    title: "Settings",
    language: "Language",
    appearance: "Appearance",
    version: "Version",
    languageHe: "עברית",
    languageEn: "English",
    themeLight: "Light",
    themeDark: "Dark",
  },
  inventory: inventoryEn,
};

export const dictionaries: Record<Locale, Messages> = { he, en };

/** Dot-paths into the message tree, e.g. `"home.emptyTitle"`. */
export type MessageKey = {
  [K in keyof Messages]: `${K & string}.${keyof Messages[K] & string}`;
}[keyof Messages];

/** Resolve a dot-path key against a dictionary (falls back to the key itself). */
export function translate(messages: Messages, key: MessageKey): string {
  const [namespace, leaf] = key.split(".") as [keyof Messages, string];
  const section = messages[namespace] as Record<string, string> | undefined;
  return section?.[leaf] ?? key;
}
