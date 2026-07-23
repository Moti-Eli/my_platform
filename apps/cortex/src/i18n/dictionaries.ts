/**
 * Translation dictionaries (he default, en full parallel). The `he` object
 * defines the canonical shape; `en` must match it (typed as {@link Messages}).
 * Keys are addressed by dot-path (e.g. `t("home.allTab")`), type-checked via
 * {@link MessageKey}.
 */
import type { Locale } from "./config";
// Tool dictionaries are supplied by each tool and merged here under the tool's
// namespace (Standard §8: central i18n consumes tool keys). Keys become
// type-checked (e.g. t("inventory.name")).
import inventoryHe from "@/tools/inventory/i18n/he.json";
import inventoryEn from "@/tools/inventory/i18n/en.json";
import tasksHe from "@/tools/tasks/i18n/he.json";
import tasksEn from "@/tools/tasks/i18n/en.json";
import staffHe from "@/tools/staff/i18n/he.json";
import staffEn from "@/tools/staff/i18n/en.json";
import notesHe from "@/tools/notes/i18n/he.json";
import notesEn from "@/tools/notes/i18n/en.json";
import expensesHe from "@/tools/expenses/i18n/he.json";
import expensesEn from "@/tools/expenses/i18n/en.json";
import journalHe from "@/tools/journal/i18n/he.json";
import journalEn from "@/tools/journal/i18n/en.json";
import candidatesHe from "@/tools/candidates/i18n/he.json";
import candidatesEn from "@/tools/candidates/i18n/en.json";

const he = {
  login: {
    title: "כניסה ל-Cortex",
    subtitle: "התחבר כדי להמשיך",
    email: "אימייל",
    password: "סיסמה",
    submit: "כניסה",
    signingIn: "מתחבר…",
    // Error keys. NEVER render a raw error message from the server — map to one
    // of these. `invalidCredentials` is the 401 case (bad email/password: try
    // again). `notPermitted` is the 403 case (authenticated, but not allowed
    // through) — a different answer needing a different action, so it is never
    // collapsed into the 401 text. `notConfigured` means the app has no Supabase
    // env, which is an operator problem, not the user's.
    invalidCredentials: "אימייל או סיסמה שגויים",
    notPermitted: "החשבון מזוהה אך אינו מורשה להיכנס",
    notConfigured: "המערכת אינה מחוברת לשרת",
    failed: "הכניסה נכשלה, נסה שוב",
  },
  // Self-service signup. Error keys ONLY for now (UI labels come later). Each maps
  // 1:1 from a `signUpWithNewOrganization` error key in @platform/auth, plus
  // `notConfigured` (admin client env missing) — same never-render-raw rule as login.
  signup: {
    title: "הרשמה ל-Cortex",
    subtitle: "צור חשבון חדש כדי להתחיל",
    displayName: "שם (לא חובה)",
    submit: "הרשמה",
    signingUp: "נרשם…",
    switchToSignup: "אין לך חשבון? הרשמה",
    switchToLogin: "כבר יש לך חשבון? כניסה",
    invalidEmail: "כתובת אימייל לא תקינה",
    invalidName: "יש להזין שם",
    invalidOrgName: "יש להזין שם ארגון",
    invalidPassword: "הסיסמה חייבת להכיל לפחות 6 תווים",
    emailExists: "כתובת האימייל כבר רשומה",
    notConfigured: "המערכת אינה מחוברת לשרת",
    failed: "ההרשמה נכשלה, נסה שוב",
  },
  session: {
    noOrgTitle: "אין לך ארגון",
    noOrgHint: "החשבון שלך אינו משויך לאף ארגון. פנה למנהל המערכת כדי שיצרף אותך.",
    signOut: "יציאה",
  },
  // The (app) route-group error boundary. Calm and non-alarming by design —
  // never a crash dump; the technical error goes to the console only.
  error: {
    title: "משהו לא הסתדר",
    hint: "אירעה תקלה זמנית. אפשר פשוט לנסות שוב.",
    retry: "נסה שוב",
  },
  // The root 404 — a wrong address, not a failure; same calm register.
  notFound: {
    title: "הדף הזה לא נמצא",
    hint: "יכול להיות שהכתובת השתנתה או שהוקלדה בטעות.",
    action: "חזרה למסך הבית",
  },
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
    // DEV demo notification content (temporary — see useNotifications).
    inventoryTitle: "מוצרים חסרים במלאי",
    inventoryDesc: "6 מוצרים ירדו מתחת לסף ההזמנה מחדש.",
    calendarTitle: "פגישה בעוד שעתיים",
    calendarDesc: "פגישת צוות שבועית ב-14:00 באולם הישיבות.",
    expensesTitle: "חריגה מהתקציב החודשי",
    expensesDesc: "ההוצאות החודש עברו את התקציב ב-12%.",
    tasksTitle: "משימה שעברה את התאריך",
    tasksDesc: "‘הגשת דוח רבעוני’ הייתה אמורה להסתיים אתמול.",
    contactsTitle: "ליד חדש ממתין למענה",
    contactsDesc: "התקבלה פנייה חדשה מהאתר שטרם טופלה.",
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
    adminOnly: "מנהל",
    remove: "הסרה",
    pin: "נעץ",
    unpin: "בטל נעיצה",
  },
  home: {
    appTabsLabel: "לשוניות כלים",
    allTab: "הכל",
    dashboardLabel: "לוח מחוונים",
    emptyInstalledTitle: "עדיין לא הוספת כלים",
    emptyInstalledHint: "הקש על + כדי להוסיף כלים ללוח שלך.",
  },
  catalog: {
    title: "כל הכלים",
    addToBar: "הוסף לשורת הכלים",
    removeFromBar: "הסר משורת הכלים",
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
    roleAdmin: "מנהל",
    roleMember: "חבר",
    menu: "תפריט",
    changePhoto: "שינוי תמונה",
    // Section headers
    sectionIdentity: "זהות",
    sectionData: "הנתונים שלי",
    sectionActivity: "פעילות",
    sectionSystem: "מערכת",
    sectionSession: "חשבון",
    // Row labels
    identityCard: "כרטיס ביקור",
    personalDetails: "פרטים אישיים",
    organizations: "ארגונים",
    appsSummary: "סיכום מהאפליקציות",
    documents: "מסמכים",
    recentActivity: "פעילות אחרונה",
    aiActivity: "מה ה-AI עשה",
    // Create a new organization (next to the org switcher). Error keys map 1:1 from
    // createOrganizationForCurrentUser in @platform/auth; same never-render-raw rule.
    createOrgTitle: "צור ארגון חדש",
    createOrgPlaceholder: "שם הארגון החדש",
    createOrgSubmit: "צור ארגון",
    createOrgSubmitting: "יוצר…",
    createOrgInvalidName: "יש להזין שם ארגון",
    createOrgNotAllowed: "אינך מורשה ליצור ארגון",
    createOrgFailed: "יצירת הארגון נכשלה, נסה שוב",
    createOrgNotConfigured: "המערכת אינה מחוברת לשרת",
  },
  settings: {
    title: "הגדרות",
    language: "שפה",
    appearance: "נראות",
    version: "גרסה",
    languageHe: "עברית",
    languageEn: "English",
    // Theme names are product names (VS Code-inspired) — English in BOTH locales.
    themeAbyss: "Abyss",
    themeMidnight: "Midnight",
    themeSlate: "Slate",
    themeDawn: "Dawn",
    themeQuietLight: "Quiet Light",
    themeClay: "Clay",
    versionAbout:
      "Cortex הוא סופר-אפליקציה לניהול העסק שלך: כל הכלים שאתה צריך במקום אחד, עם עוזר AI שמחבר ביניהם.",
  },
  search: {
    hint: "התחל להקליד כדי לחפש",
    noResults: "לא נמצאו תוצאות",
    more: "עוד {count}",
  },
  inventory: inventoryHe,
  tasks: tasksHe,
  staff: staffHe,
  notes: notesHe,
  expenses: expensesHe,
  journal: journalHe,
  candidates: candidatesHe,
} as const;

/** The canonical message shape (derived from `he`). */
export type Messages = {
  [K in keyof typeof he]: { [P in keyof (typeof he)[K]]: string };
};

const en: Messages = {
  login: {
    title: "Sign in to Cortex",
    subtitle: "Sign in to continue",
    email: "Email",
    password: "Password",
    submit: "Sign in",
    signingIn: "Signing in…",
    invalidCredentials: "Incorrect email or password",
    notPermitted: "This account is recognised but is not allowed to sign in",
    notConfigured: "The app is not connected to a server",
    failed: "Sign-in failed, please try again",
  },
  signup: {
    title: "Sign up for Cortex",
    subtitle: "Create a new account to get started",
    displayName: "Name (optional)",
    submit: "Sign up",
    signingUp: "Signing up…",
    switchToSignup: "Don't have an account? Sign up",
    switchToLogin: "Already have an account? Sign in",
    invalidEmail: "Invalid email address",
    invalidName: "Please enter a name",
    invalidOrgName: "Please enter an organization name",
    invalidPassword: "The password must be at least 6 characters",
    emailExists: "That email is already registered",
    notConfigured: "The app is not connected to a server",
    failed: "Sign-up failed, please try again",
  },
  session: {
    noOrgTitle: "You have no organization",
    noOrgHint:
      "Your account isn't attached to any organization. Ask an administrator to add you to one.",
    signOut: "Sign out",
  },
  error: {
    title: "Something didn't go as planned",
    hint: "A temporary hiccup. Just try again.",
    retry: "Try again",
  },
  notFound: {
    title: "This page wasn't found",
    hint: "The address may have changed or been mistyped.",
    action: "Back to home",
  },
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
    // DEV demo notification content (temporary — see useNotifications).
    inventoryTitle: "Products low in stock",
    inventoryDesc: "6 products dropped below the reorder threshold.",
    calendarTitle: "Meeting in two hours",
    calendarDesc: "Weekly team meeting at 14:00 in the conference room.",
    expensesTitle: "Monthly budget exceeded",
    expensesDesc: "This month's spend is 12% over budget.",
    tasksTitle: "Task past its due date",
    tasksDesc: "‘Submit quarterly report’ was due yesterday.",
    contactsTitle: "New lead awaiting reply",
    contactsDesc: "A new inquiry from the website hasn't been handled yet.",
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
    adminOnly: "Admin only",
    remove: "Remove",
    pin: "Pin",
    unpin: "Unpin",
  },
  home: {
    appTabsLabel: "Tool tabs",
    allTab: "All",
    dashboardLabel: "Dashboard",
    emptyInstalledTitle: "No apps yet",
    emptyInstalledHint: "Tap + to add apps to your board.",
  },
  catalog: {
    title: "All tools",
    addToBar: "Add to tools bar",
    removeFromBar: "Remove from tools bar",
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
    roleAdmin: "Admin",
    roleMember: "Member",
    menu: "Menu",
    changePhoto: "Change photo",
    // Section headers
    sectionIdentity: "Identity",
    sectionData: "My data",
    sectionActivity: "Activity",
    sectionSystem: "System",
    sectionSession: "Account",
    // Row labels
    identityCard: "Business card",
    personalDetails: "Personal details",
    organizations: "Organizations",
    appsSummary: "Summary from apps",
    documents: "Documents",
    recentActivity: "Recent activity",
    aiActivity: "What the AI did",
    // Create a new organization (next to the org switcher). Error keys map 1:1 from
    // createOrganizationForCurrentUser in @platform/auth; same never-render-raw rule.
    createOrgTitle: "Create a new organization",
    createOrgPlaceholder: "New organization name",
    createOrgSubmit: "Create organization",
    createOrgSubmitting: "Creating…",
    createOrgInvalidName: "Please enter an organization name",
    createOrgNotAllowed: "You're not allowed to create an organization",
    createOrgFailed: "Creating the organization failed, please try again",
    createOrgNotConfigured: "The app is not connected to a server",
  },
  settings: {
    title: "Settings",
    language: "Language",
    appearance: "Appearance",
    version: "Version",
    languageHe: "עברית",
    languageEn: "English",
    // Theme names are product names (VS Code-inspired) — English in BOTH locales.
    themeAbyss: "Abyss",
    themeMidnight: "Midnight",
    themeSlate: "Slate",
    themeDawn: "Dawn",
    themeQuietLight: "Quiet Light",
    themeClay: "Clay",
    versionAbout:
      "Cortex is a super-app for running your business: every tool you need in one place, tied together by an AI assistant.",
  },
  search: {
    hint: "Start typing to search",
    noResults: "No results",
    more: "+{count} more",
  },
  inventory: inventoryEn,
  tasks: tasksEn,
  staff: staffEn,
  notes: notesEn,
  expenses: expensesEn,
  journal: journalEn,
  candidates: candidatesEn,
};

export const dictionaries: Record<Locale, Messages> = { he, en };

/** Dot-paths into the message tree, e.g. `"home.allTab"`. */
export type MessageKey = {
  [K in keyof Messages]: `${K & string}.${keyof Messages[K] & string}`;
}[keyof Messages];

/** Resolve a dot-path key against a dictionary (falls back to the key itself). */
export function translate(messages: Messages, key: MessageKey): string {
  const [namespace, leaf] = key.split(".") as [keyof Messages, string];
  const section = messages[namespace] as Record<string, string> | undefined;
  return section?.[leaf] ?? key;
}
