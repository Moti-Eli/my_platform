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
    placeholder: "שאל את Cortex…",
    notConnected: "העוזר עדיין לא מחובר למנוע — זהו שלד בלבד.",
    mic: "הקלטה",
    attach: "צירוף",
    attachCamera: "מצלמה",
    attachPhotos: "תמונות",
    attachFiles: "קבצים",
    searchInChat: "חיפוש בשיחה",
    searchPlaceholder: "חיפוש בשיחה…",
    newChat: "שיחה חדשה",
    history: "היסטוריית שיחות",
    expand: "הרחבה",
    collapse: "כיווץ",
    copy: "העתקה",
    copied: "הועתק",
    deleteMessage: "מחיקה",
    rename: "שינוי שם",
    delete: "מחיקה",
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
  // App display names (registry name keys) + catalog/chip action labels. Many are
  // TEMP stub apps today; the keys stay as tools become real.
  apps: {
    calendar: "יומן",
    tasks: "משימות",
    contacts: "אנשי קשר",
    expenses: "הוצאות",
    notes: "פתקים",
    invoices: "חשבוניות",
    crm: "לקוחות",
    employees: "עובדים",
    shifts: "משמרות",
    payroll: "שכר",
    suppliers: "ספקים",
    orders: "הזמנות",
    bookings: "תורים",
    projects: "פרויקטים",
    documents: "מסמכים",
    analytics: "אנליטיקה",
    marketing: "שיווק",
    support: "תמיכה",
    fitness: "כושר",
    comingSoon: "בקרוב",
    unavailable: "לא זמין",
    remove: "הסרה",
  },
  home: {
    appTabsLabel: "לשוניות כלים",
    allTab: "הכל",
    dashboardLabel: "לוח מחוונים",
    emptyTitle: "עדיין אין כלים מוצמדים",
    emptyHint: "כלים שתצמיד יופיעו כאן על לוח המחוונים.",
    emptyInstalledTitle: "עדיין לא הוספת כלים",
    emptyInstalledHint: "הקש על + כדי להוסיף כלים ללוח שלך.",
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
    // DEV placeholder identity — no auth yet; replace with the session user.
    name: "המשתמש",
    contactPlaceholder: "הוספת אימייל או טלפון",
    menu: "תפריט",
    changePhoto: "שינוי תמונה",
    // Section headers
    sectionIdentity: "זהות",
    sectionData: "הנתונים שלי",
    sectionActivity: "פעילות",
    sectionSystem: "מערכת",
    // Row labels
    identityCard: "כרטיס ביקור",
    personalDetails: "פרטים אישיים",
    organizations: "ארגונים",
    appsSummary: "סיכום מהאפליקציות",
    documents: "מסמכים",
    recentActivity: "פעילות אחרונה",
    aiActivity: "מה ה-AI עשה",
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
    versionAbout:
      "Cortex הוא סופר-אפליקציה לניהול העסק שלך: כל הכלים שאתה צריך במקום אחד, עם עוזר AI שמחבר ביניהם.",
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
    placeholder: "Ask Cortex…",
    notConnected: "The assistant isn't connected to an engine yet — this is a shell only.",
    mic: "Record",
    attach: "Attach",
    attachCamera: "Camera",
    attachPhotos: "Photos",
    attachFiles: "Files",
    searchInChat: "Search in chat",
    searchPlaceholder: "Search in chat…",
    newChat: "New chat",
    history: "Conversation history",
    expand: "Expand",
    collapse: "Collapse",
    copy: "Copy",
    copied: "Copied",
    deleteMessage: "Delete",
    rename: "Rename",
    delete: "Delete",
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
  // App display names (registry name keys) + catalog/chip action labels. Many are
  // TEMP stub apps today; the keys stay as tools become real.
  apps: {
    calendar: "Calendar",
    tasks: "Tasks",
    contacts: "Contacts",
    expenses: "Expenses",
    notes: "Notes",
    invoices: "Invoices",
    crm: "Customers",
    employees: "Employees",
    shifts: "Shifts",
    payroll: "Payroll",
    suppliers: "Suppliers",
    orders: "Orders",
    bookings: "Appointments",
    projects: "Projects",
    documents: "Documents",
    analytics: "Analytics",
    marketing: "Marketing",
    support: "Support",
    fitness: "Fitness",
    comingSoon: "Coming soon",
    unavailable: "Unavailable",
    remove: "Remove",
  },
  home: {
    appTabsLabel: "Tool tabs",
    allTab: "All",
    dashboardLabel: "Dashboard",
    emptyTitle: "Nothing pinned yet",
    emptyHint: "Tools you pin will appear here on the dashboard.",
    emptyInstalledTitle: "No apps yet",
    emptyInstalledHint: "Tap + to add apps to your board.",
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
    // DEV placeholder identity — no auth yet; replace with the session user.
    name: "User",
    contactPlaceholder: "Add email or phone",
    menu: "Menu",
    changePhoto: "Change photo",
    // Section headers
    sectionIdentity: "Identity",
    sectionData: "My data",
    sectionActivity: "Activity",
    sectionSystem: "System",
    // Row labels
    identityCard: "Business card",
    personalDetails: "Personal details",
    organizations: "Organizations",
    appsSummary: "Summary from apps",
    documents: "Documents",
    recentActivity: "Recent activity",
    aiActivity: "What the AI did",
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
    versionAbout:
      "Cortex is a super-app for running your business: every tool you need in one place, tied together by an AI assistant.",
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
