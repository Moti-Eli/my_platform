# Cortex — פרוטוקול הוספת כלי חדש (בלי הפתעות)

גרסה 2 · מזוקק מבניית הכלי `candidates`. **שלם — אין צעדים פתוחים.**

> מנגנון `app_definitions` אומת: **מיגרציית seed**, לא sync ולא script. ראה Phase A2.

---

## מטא-זרימה (לא משתנה)
מתכננים בעברית → אני כותב פרומפט אנגלית ל-Claude Code → אתה מריץ → אתה בודק → אתה מקמט ב-git לבד.
**audit לפני כתיבה:** קוראים קוד חי (לא זיכרון, לא סיכומים), מציגים מה נמצא ומה משתנים, ורק אז כותבים.
**פרומפט אחד = שינוי אחד יציב ובדיק.**

---

## 0. לפני שמתחילים — האם זה בכלל "עוד כלי"?
**עצור ותכנן בנפרד** (זה לא clone) אם הכלי דורש מנגנון שאין היום:
- אחסון קבצים (Storage) — העלאת מסמכים/תמונות.
- endpoint / אינטגרציה חיצונית.
- זהות חיצונית — משתמש שאינו חבר ארגון (פורטל מועמד/עובד).
- הפקת מסמך אוטומטי (חוזה/PDF), חתימה אונליין.
- מחיקה/כתיבה לטבלה בלי grant קיים.

כל אחד מאלה = פרומפט תכנון נפרד, **לא** חלק מזרימת הכלי.

---

## 1. להכריע ולנעול מראש (החלטות עיצוב — לפני בנייה, לא תוך כדי)
- **שם תצוגה** — i18n key `<tool>.name`, גנרי, לא ספציפי-ארגון.
- **אייקון** — קיים ב-`icons.tsx`? ממופה ב-`app-visuals.tsx` (ICONS)? אם הגליף קיים אך לא רשום — נרשום אותו (import + שורה ב-map). זה צעד צפוי, לא סטייה.
- **צבע** — מהפלטה (6: violet / teal / coral / amber / blue / green). **מיחזור צבעים מותר ומצופה מכלי 7 והלאה.** "צבע ייחודי לכל כלי" מעולם לא היה כלל — רק הערות שכל כלי העתיק מהקודם. אל תבזבז עליו זמן.
- **שדות הטבלה** — מעבר לחובה (owner_id / org_id / visibility / created_at / updated_at). טיפוסים מפורשים. `text[]` / `boolean` / `check`-enum הם בסדר — אינם "מנגנון חדש".
- **סמנטיקה** — האם צריך intent שאינו CRUD (כמו `set_stage` לפייפליין)? זו הסטייה המותרת היחידה מהתבנית — **הצהר עליה בפרומפט**.
- **אם עובדים עם מעצב חיצוני (Lovable):** הפלט = reference עיצובי בלבד. אין לו `runIntentAction`, אין שדות RLS, אין tokens משותפים — לא מתחבר כקוד.

---

## 2. Phase A — מיגרציית DB (פרומפט 1)
מירר מיגרציה קיימת (notes/tasks), **verbatim** למודל האבטחה. רק העמודות ושם הטבלה משתנים.

**הטבלה `public.<tool>`:**
- `id uuid pk default gen_random_uuid()`
- `owner_id uuid not null references public.users (id)`
- `org_id uuid not null references public.organizations (id) on delete cascade`
- `visibility text not null default 'org' check (in private/org/restricted)`
- שדות הכלי + `created_at`, `updated_at timestamptz not null default now()`
- אינדקסים על `(org_id)` ו-`(owner_id)`.

**RLS:**
- `enable row level security`.
- `grant select` → SELECT policy: `auth_user_is_member_of_tree(org_id) and visibility='org'` (fail-closed).
- `grant insert, update, delete` → authenticated.
- INSERT: `auth_user_can_write('<tool>', id, org_id, owner_id, visibility)` **וגם** `owner_id = (select auth.uid())`.
- UPDATE: can_write ב-USING **וב-**WITH CHECK.
- DELETE: can_write ב-USING בלבד (delete לא מייצר שורה חדשה).

**מגבלות:** `auth_user_can_write` גנרי (`p_table_name`) — בלי פונקציה חדשה, בלי לגעת בקיימת. **בלי** immutability trigger (gap מכוון, כמו notes/tasks). בלי לגעת ב-anon/service_role. בלי טבלה אחרת.

**בלי version bump** — זה `packages/db`, לא `apps/cortex`.

שם קובץ: `<timestamp מאוחר מהאחרון>_<tool>_table.sql`.

**בדיקה (DB = סיכון גבוה → מלא):**
1. git commit — קובץ מדויק בלבד.
2. dry-run מ-packages\db, חזרה לשורש; ודא ש**רק** המיגרציה החדשה ממתינה:
   `cd /d %USERPROFILE%\Desktop\my-platform\packages\db & npx supabase db push --dry-run & cd /d %USERPROFILE%\Desktop\my-platform`
3. push (בלי `--dry-run`) + חזרה לשורש.
4. **אימות מול production — קטלוג חי, לא הסקה מהקובץ:**
   - grants ל-authenticated → `DELETE, INSERT, MAINTAIN, SELECT, UPDATE` (חמישה).
   - policies → **4** (אחת לכל cmd: SELECT/INSERT/UPDATE/DELETE).

---

## 2b. Phase A2 — מיגרציית seed ל-`app_definitions` (חובה!)
**הכלי לא ניתן להתקנה בלי זה.** `installApp` פותר `definition_id` לפי `key` מ-`public.app_definitions`;
אין שורה → `installApp: unknown app "<tool>"`. הכלי כן יופיע בקטלוג (הוא ב-registry שבקוד) — אבל ההתקנה תזרוק.

**המנגנון (מאומת):** מיגרציית seed רגילה. **אין** sync מה-registry, **אין** upsert ב-boot, **אין** script.
כל קוד ה-TS רק **קורא** מהטבלה.

מירר את `20260720000002_seed_app_definitions.sql`:
```sql
insert into public.app_definitions (key, name, category, icon, color, manifest)
values ('<tool>', '<tool>.name', '<category>', '<icon>', '<color>', '<manifest>'::jsonb)
on conflict (key) do nothing;
```
- `name` = מפתח i18n (לא טקסט תצוגה).
- `manifest` = ה-`AppManifest` מ-`manifest.ts`, **מועתק verbatim** כ-JSONB.
- additive בלבד; `ON CONFLICT DO NOTHING`; בלי לגעת בשורות קיימות.

**החלה:** commit → dry-run → push → אימות:
```sql
select key, name, category, icon, color from public.app_definitions order by key;
```
הכלי החדש חייב להופיע עם האייקון/הצבע/הקטגוריה הנכונים.

> ⚠️ **חוב ידוע — כפילות מניפסט.** המניפסט חי בשני מקומות: `manifest.ts` (TS) ו-JSONB במיגרציה.
> שינוי עתידי ב-manifest של כלי **לא** יתעדכן ב-DB מאליו. אין היום מנגנון שמיישר ביניהם.
> לא לפתור בזרימת כלי — פריט לסבב נפרד.

---

## 3. Phase B — קבצי הכלי + רישום (פרומפט אחד, מאוחד)
**לקח מרכזי:** לפצל "קבצים" מ"רישום" יצר קומיט-ביניים שהוא dead code לא-בדיק — הפיצול לא קונה verifiability, רק רעש. השינוי האטומי האמיתי הוא **"הכלי קיים, מותקן ונפתח"**. מאחדים.

מירר את `notes`:
- **6 קבצים:** `manifest.ts`, `intents.ts`, `logic.ts`, `events.ts`, `lib/query/use<Tool>List.ts`, `views/DashboardCard.tsx` + `views/FullScreen.tsx`.
- **i18n:** `<tool>/i18n/he.json` + `en.json` → merge ל-`i18n/dictionaries.ts`.
- **רישום (4 מקומות):** `tools/index.ts` (TOOL_VIEWS), `cortex/runtime.ts` (client), `cortex/server-runtime.ts` (server: registerApp + intents + listeners), `app/(app)/tools/<tool>/page.tsx` (requireSession, מעביר userId/orgId; redirect isAdmin רק אם admin-gated). הסר stub מ-`stub-apps.ts` אם קיים.
- **version.ts** — bump ב-1 (increment, לא hardcode).

> **קדם-תנאי:** בלי שורת `app_definitions` (Phase A2) ההתקנה תזרוק `installApp: unknown app`.
> אפשר לבנות את Phase B קודם, אבל **הכלי לא יהיה מותקן** עד ש-A2 הוחל.

**בדיקה (רישום נוגע ב-server-only + route חדש → build, לא רק typecheck):**
- `pnpm --filter cortex build` → אם עובר, `pnpm --filter cortex start` (פורט **3001**) → דפדפן.
- `build` תופס חציות RSC/client-boundary ש-typecheck מפספסת, ומריץ sync-on-boot אם זה המנגנון של app_definitions.

---

## 4. Checklist דפדפן (קבלה סופית)
- הכלי **מופיע** (עיגול צבע + אייקון).
- **מותקן בלי שגיאה** ← זה מה ש-Phase A2 מגן עליו.
- **נפתח.**
- CRUD: הוספה (ולידציה גלויה + double-submit guard), רשימה, עריכה inline, מחיקה two-tap.
- זרימות ייחודיות (שלבים / דגלים / וכו').

---

## 5. Playbook תקלות (מה שכבר נשרפנו עליו)

| סימפטום | סיבה אמיתית | תיקון |
|---|---|---|
| **Hydration error** | **staleness** — השרת הגיש HTML ישן מול JS לקוח חדש. **לא** קוד, **לא** המשתמש שמחובר. | נקה `.next` + DevTools → Application → **Clear site data** + Ctrl+Shift+R. או פשוט `build && start` — עוקף את כל רעש ה-HMR. |
| **installApp: unknown app** | אין שורת `app_definitions` לכלי. | Phase A2 — מיגרציית seed. ודא שהוחלה (`db push`), לא רק שנכתבה. |
| **קטלוג ריק** | `crypto.randomUUID` לא זמין על origin לא-מאובטח (IP/HTTP); SW מגיש bundle ישן. | production build; localhost או https בלבד. |
| **הכלי לא מופיע** | רישום חסר באחד מ-4 מקומות הרישום. | ודא tools/index + runtime + server-runtime + page.tsx. |
| **dev לא עובד בטלפון (LAN)** | dev server לא רץ על IP. | `build && start` / `vercel --prod` בלבד. |

**כלל אצבע:** Hydration error ≈ staleness כמעט תמיד. הפתרון הוא ניקוי/רענון, לא שינוי קוד.

---

## 6. git & CLI — קונבנציות
- כל שורת git: `cd /d %USERPROFILE%\Desktop\my-platform &` … מפריד `&` … **קבצים מדויקים** (לעולם לא `-A` — `pnpm-lock.yaml` יזחל פנימה) … `--no-verify` … סיום `git status -s`.
- נתיב שמכיל `(app)` → **בציטוט**: `"apps/cortex/src/app/(app)/tools/<tool>/page.tsx"` (cmd חונק על סוגריים).
- פקודות DB/תיקייה: **תמיד חוזרות לשורש** בסוף (`& cd /d %USERPROFILE%\Desktop\my-platform`) — מונע הרצת git בתיקייה הלא-נכונה.
- `supabase` CLI אינו dependency מקומי → `npx supabase` / `pnpm dlx supabase` מ-`packages\db`.

---

## 7. פריטים ל"פרומפט נפרד" (לא לבנדל בבניית כלי)
- StarIcon אמיתי (כרגע urgent על SparkIcon).
- הרחבת `useGlobalSearch` לכלי החדש.
- הרחבת הפלטה לצבע 7 (שינוי design-system על פני כל הת'מות — נדחה עד שנעשה סבב עיצוב).
- אי-רישום ה-SW ב-development (guard ל-production בלבד) — מנקה את כאב ה-staleness מהשורש.
- הוספת `supabase` כ-devDependency ב-`packages/db`.
- **יישור כפילות המניפסט** (TS ↔ JSONB ב-`app_definitions`) — היום מתפצלים בשקט.

---

## 8. לקח על ה-audit עצמו
העותק השטוח של הפרויקט **מיושן**. ב-audit של `candidates` פספסתי את `20260720000002_seed_app_definitions.sql`
כי היא נוספה אחרי ה-snapshot — ומשם הגיעה כל ההפתעה של `installApp`.

**מסקנה:** ב-audit של כל כלי חדש, אל תסתמך על רשימת הקבצים שברשותי.
בקש מ-Claude Code (שרואה קוד חי) לאשר במפורש:
1. מהי המיגרציה האחרונה בפועל?
2. מה הקבצים שרשומים בהם כלים היום (tools/index, runtime, server-runtime)?
3. האם `app_definitions` נזרע במיגרציה נפרדת?

זה עולה שאלה אחת ומונע סבב תיקון שלם.

כל אחד = שינוי ממוקד עצמאי, לא חלק מזרימת הכלי.
