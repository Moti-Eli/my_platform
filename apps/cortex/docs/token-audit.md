# Cortex design-tokens audit — mapping round

**Purpose:** map every place a colour/visual decision is made in `apps/cortex/src`, ahead of converting the design-system from colour-named tokens (`indigo/teal/coral/amber`) to semantic tokens (`accent/success/warning/danger/…`) and adding 6 themes. **Nothing is changed here — this is a read-only map.**

## How the token layer is wired today (context)

- `design-system/tokens.ts` is the source: per-theme values (`screen, card, ink, muted, hairline, indigo, teal, coral, amber` + 3 shadows) emitted as `--ds-*` CSS vars per `[data-theme]`, plus structural `radii` + `fontSans`.
- `app/globals.css` `@theme inline` maps those onto Tailwind utilities: colours (`bg-indigo`, `text-ink`, …), radii **only `md/lg/xl`**, shadows **only `soft/lifted/hero`**, font.
- **Consequences that matter for this migration:**
  - `@theme inline` only **adds** — the entire default Tailwind palette (`bg-white`, `text-gray-500`, …), default radii (`rounded-2xl/3xl/sm`), and default shadows (`shadow-lg`) all remain live footguns.
  - `radii.pill` (999px) exists in `tokens.ts` but is **never emitted** (`baseStylesheet()` emits md/lg/xl only) and **never mapped** in `@theme`. So `rounded-pill` is a **dangling utility** (see Bugs).
  - Colour names are used for **two different jobs** at once — semantic roles *and* a per-app brand palette (see Semantic collisions). This is the central thing the migration must split.

## Clean bill (categories that produced NO findings)

- **(1) Raw hex/rgb/hsl in components:** none. All hex/rgba live only in `tokens.ts` (the source layer), as intended.
- **(2) Default Tailwind palette** (`gray/slate/zinc/red/blue-…`, `bg-white`, `text-black`): none — the *only* default-palette class in use is `text-white` (always as on-accent text; listed below).
- **(3) Arbitrary colour classes** (`bg-[#…]`, `text-[…]` colour): none. The only `-[…]` classes are sizing (`text-[11px]`, `text-[10px]`, `max-h-[80dvh]`, `min-w-44`, positional `style` values) — not colour.
- **Shadows:** no default `shadow-sm/md/lg/xl/2xl/inner` and no `drop-shadow-*` anywhere. All shadows are the tokenised `shadow-soft/lifted/hero`.

## Findings

| file:line | current code (short) | cat | what it MEANS semantically | proposed semantic token | conf |
|---|---|---|---|---|---|
| app-visuals.tsx:48 | `indigo: "bg-indigo/15 text-indigo"` | 4,7 | per-app **brand** palette entry — an app that picked "indigo" (icon disc tint + glyph) | `app-accent-indigo` + `accent-subtle-surface` (brand palette, NOT a role) | med |
| app-visuals.tsx:49 | `teal: "bg-teal/15 text-teal"` | 4,7 | per-app brand palette entry (teal) | `app-accent-teal` | med |
| app-visuals.tsx:50 | `coral: "bg-coral/15 text-coral"` | 4,7 | per-app brand palette entry (coral) | `app-accent-coral` | med |
| app-visuals.tsx:51 | `amber: "bg-amber/15 text-amber"` | 4,7 | per-app brand palette entry (amber) | `app-accent-amber` | med |
| Header.tsx:35 | `text-indigo` (wordmark) | 4 | brand identity mark | `brand` / `primary` (fg) | high |
| Header.tsx:36 | `style={{ fontFamily: '"Segoe Script"…cursive' }}` | 8* | brand **display font** for the wordmark — hard-coded, no token | new `font-display` token | med |
| Header.tsx:87 | `bg-ink/30` (search scrim) | 5 | modal **scrim/overlay** dim | `scrim` (theme-independent dark) | high |
| TabBar.tsx:43 | `text-indigo` (active) : `text-muted` | 4 | active/selected tab indicator | `accent`/`selected` (fg) | high |
| TabBar.tsx:115 | `text-white` (hero glyph) | 2 | icon on the saturated hero surface | `on-accent` | high |
| TabBar.tsx:116 | `aiOpen ? "bg-ink" : "bg-indigo"` | 4,5 | AI hero: primary surface (closed) → **inverse/active** surface (open) | `primary` (surface) + `inverse-surface` | high |
| AppTabsRow.tsx:99,114,160 | `bg-ink text-screen` (selected chip) | 5 | **inverse** high-emphasis surface + on-inverse text (correct inversion, works both themes) | `inverse-surface` + `on-inverse` | high |
| AppTabsRow.tsx:115 | `ring-2 ring-coral` (menu-open chip) | 4 | attention/target ring on the chip being uninstalled | `danger` or `focus-ring` (needs decision) | low |
| AppTabsRow.tsx:206 | `text-coral` (remove) | 4 | **destructive** action label | `danger` (fg) | high |
| AiSheet.tsx:153 | `bg-ink/30` (sheet scrim) | 5 | modal scrim/overlay dim | `scrim` | high |
| AiSheet.tsx:261 | `bg-indigo text-white` (send) | 4,2 | primary-action surface + on-primary text | `primary` (surface) + `on-accent` | high |
| AiSheet.tsx:324 | `bg-ink … text-white` (toast) | 5,2 | transient **inverse-surface** toast + its text | `inverse-surface` + `on-inverse` (NOT white) | high |
| AiSheet.tsx:408 | `${actionBtn} text-coral` (delete msg) | 4 | destructive action | `danger` (fg) | high |
| AiSheet.tsx:589 | `text-coral` (delete conversation) | 4 | destructive action | `danger` (fg) | high |
| SettingsList.tsx:47 | `bg-card text-indigo` (row icon) | 4 | generic accent-coloured list-row icon | `accent`/`primary` (fg) | high |
| ThemePicker.tsx:36 | `ring-indigo` : `ring-hairline` (active card) | 4 | selected theme-card ring | `accent`/`selected-ring` | high |
| ThemePicker.tsx:42 | `style={{ backgroundColor: tokens.screen }}` | 8 | theme-preview swatch: screen surface (reads raw token obj) | preview reads token object — must track `screen` rename | high |
| ThemePicker.tsx:46 | `style={{ backgroundColor: tokens.card }}` | 8 | theme-preview swatch: card surface | preview — tracks `card` rename | high |
| ThemePicker.tsx:50 | `style={{ backgroundColor: tokens.indigo }}` | 8 | theme-preview accent swatch — **hard dependency on the `indigo` field name** | preview — must become `tokens.accent` at migration | high |
| ThemePicker.tsx:55 | `text-indigo` (check) | 4 | selected indicator | `accent`/`selected` (fg) | high |
| LanguagePicker.tsx:33 | `text-indigo` (check) | 4 | selected indicator | `accent`/`selected` (fg) | high |
| catalog/page.tsx:34 | `installed ? "bg-teal text-white" : "bg-hairline text-muted"` | 4,2 | **installed = success/positive state** surface + on-success text | `success` (surface) + `on-accent` | high |
| UrgencyInbox.tsx:69 | `bg-ink/30` (scrim) | 5 | modal scrim/overlay dim | `scrim` | high |
| UrgencyInbox.tsx:76 | `bg-coral/15 text-coral` (bell) | 4 | urgency/alert accent tint | `danger`/`alert` + `accent-subtle-surface` | med |
| profile/page.tsx:84 | `bg-indigo/15 text-indigo` (avatar initial) | 4 | accent-tinted avatar placeholder | `accent-subtle-surface` + `accent` | med |
| profile/page.tsx:106 | `bg-indigo/15 text-indigo` (large avatar) | 4 | accent-tinted avatar placeholder | `accent-subtle-surface` + `accent` | med |
| DashboardCard.tsx:48 | `bg-amber/15 text-amber` (tool icon) | 4 | **inventory's BRAND accent** tint (icon disc) | `app-accent-amber` (brand) | high |
| DashboardCard.tsx:53 | `low.length>0 ? "text-amber" : "text-muted"` | 4 | **low-stock WARNING** count | `warning` (fg) | high |
| FullScreen.tsx:69 | `rounded-pill bg-amber … text-white` (add btn) | 4,2,6 | inventory brand primary button + on-accent text | `app-accent-amber` (surface) + `on-accent` | high |
| FullScreen.tsx:102 | `rounded-pill bg-amber/15 … text-amber` (badge) | 4,6 | **low-stock WARNING** badge | `warning` + `warning-subtle-surface` | high |
| FullScreen.tsx:202 | `bg-amber … text-white` (confirm add) | 4,2 | inventory brand primary button | `app-accent-amber` (surface) + `on-accent` | high |
| AiSheet.tsx:233 | `rounded-2xl` (user bubble) | 6 | bubble radius via Tailwind **default** 2xl(16px), not token | map to `radius-md` token | high |
| AiSheet.tsx:254 | `rounded-3xl` (composer) | 6 | composer radius via default 3xl(24px), not token | map to `radius-xl` token | high |
| AiSheet.tsx:299 | `rounded-2xl` (attach menu) | 6 | menu radius via default 2xl | `radius-md` | high |
| UrgencyInbox.tsx:73 | `rounded-2xl` (panel) | 6 | panel radius via default 2xl | `radius-md`/`radius-lg` | high |
| AiSheet.tsx:176 | `rounded-pill` (grabber) | 6 | pill bar — but `pill` is **unwired** → likely renders square | wire `radius-pill` (see Bugs) | med |
| *many files* | `rounded-full` (avatars, icon discs, badges, skeleton bars) | 6 | **circle/pill shape** (h==w discs, dot rows) — a shape choice, not a scale value | acceptable as-is; low priority | high |

\* Header.tsx:36 is an inline `style` but a **font**, not colour/shadow — included for completeness since it's a design decision outside the token layer.

## Semantic collisions (same token → different meanings)

1. **`amber` = brand accent AND warning.** Inventory uses `amber` as its **brand accent** (DashboardCard.tsx:48 icon disc; FullScreen.tsx:69,202 primary buttons) *and* as the **low-stock warning** colour (DashboardCard.tsx:53; FullScreen.tsx:102 badge) — in the **same screen**. After the split these must be two different tokens (`app-accent-amber` vs `warning`); today a theme that recolours "amber" moves both at once. **This is the headline collision.**
2. **The four names serve two orthogonal systems at once.** In `app-visuals.tsx` `indigo/teal/coral/amber` are a **neutral rotating brand palette** (each app manifest picks one via `manifest.color`). Everywhere else the *same* names encode **semantic roles**: `indigo`=primary/selected, `teal`=success, `coral`=danger/destructive, `amber`=warning. Migration must produce **two token families**: semantic roles (`primary/success/warning/danger`) *and* an app-brand palette (`app-accent-*`) — otherwise recolouring "coral" to mean danger will also recolour every coral-branded app.
3. **`coral` = danger AND alert AND target-ring.** Destructive text (AppTabsRow:206, AiSheet:408/589), urgency/alert tint (UrgencyInbox:76), and the uninstall-target ring (AppTabsRow:115). Decide whether "urgent notification" and "destructive action" are the same role.
4. **`indigo` = brand identity AND generic "selected/active".** Wordmark/brand (Header:35), primary action (AiSheet send, TabBar hero), and pure selection state (active tab, check marks, active theme ring, avatar tint). Likely all collapse to `primary`/`accent`, but "brand mark" may want to stay fixed while "selected" follows the accent — flag for decision.
5. **`ink` = primary text AND inverse surface AND scrim.** As `text-ink` it's body text; as `bg-ink` it's an inverse surface (chips, hero-open, toast); as `bg-ink/30` it's a scrim. These are three tokens wearing one name (see Missing tokens + Bugs).

## Missing tokens (a decision with no token to map to today)

| proposed token | where needed today | why |
|---|---|---|
| `on-accent` (foreground on a saturated accent surface) | `text-white` at TabBar:115, AiSheet:261, catalog:34, FullScreen:69,202 | text/icon colour on primary/success/brand surfaces is a raw `white` literal; some themes may need near-white/near-black. Also root-causes the dark-theme bugs where `text-white` sits on `bg-ink`. |
| `inverse-surface` + `on-inverse` | `bg-ink (text-screen)` chips (AppTabsRow:99/114/160); `bg-ink` hero-open (TabBar:116); `bg-ink text-white` toast (AiSheet:324) | a high-emphasis surface that must **invert per theme**. The chip pattern (`bg-ink`+`text-screen`) is the correct reference; toast/hero use `text-white` and break in dark. |
| `scrim` (overlay dim) | `bg-ink/30` at AiSheet:153, Header:87, UrgencyInbox:69 | a scrim must be a **fixed dark wash independent of theme**; deriving it from `ink` makes it a *light* wash in dark theme (see Bugs). |
| `accent-subtle-surface` (and per-role `*-subtle`) | every `bg-<colour>/15` tint (app-visuals:48-51, UrgencyInbox:76, profile:84/106, DashboardCard:48, FullScreen:102) | the "/15" tinted disc/badge background is an ad-hoc opacity; a proper subtle-surface token per accent/role avoids relying on alpha math that may not read well across 6 themes. |
| `app-accent-*` palette (separate from roles) | `app-visuals.tsx` COLOR_CLASSES | the per-app brand palette needs its own token set distinct from semantic roles (see collision #2). Open question: fixed brand hues vs theme-driven. |
| `focus-ring` / `selected-ring` | `ring-indigo` (ThemePicker:36), `ring-coral` (AppTabsRow:115), `ring-hairline` (unselected) | selection/focus ring colour is currently piggybacking on accent/coral/hairline; states deserve explicit tokens. |
| pressed/hover/disabled state surfaces | `active:bg-hairline`, `active:bg-screen`, `active:opacity-80/90`, `opacity-50` (catalog disabled) | pressed/disabled are expressed ad-hoc (a token vs an existing surface); confirm whether these become tokens or stay derived. |
| `radius-pill` | `rounded-pill` (AiSheet:176, FullScreen:69,102) | `radii.pill` exists in tokens.ts but isn't wired; the utility is currently dangling (Bugs). |
| `font-display` | Header.tsx:36 wordmark | brand/display font is a hard-coded cursive stack with no token. |

## Bugs found (already broken in one of the two current themes)

Checked `bg-ink`/scrim/`text-white` combos against the dark values in tokens.ts (`ink: #F4F2FA` ≈ near-white, `screen: #141220` dark).

1. **Toast text invisible in dark theme.** `AiSheet.tsx:324` `bg-ink … text-white`. Dark: near-white surface + white text → unreadable. (The chips do it right with `text-screen`.) Fix during migration: `inverse-surface` + `on-inverse`.
2. **AI-hero glyph invisible in dark theme when open.** `TabBar.tsx:115-116` `text-white` on `bg-ink` (open state). Dark: white icon on near-white → invisible. (Closed state `bg-indigo` is fine.)
3. **Scrims invert in dark theme.** `bg-ink/30` (AiSheet:153, Header:87, UrgencyInbox:69). Dark: `ink` is near-white, so a 30% **white** wash *lightens* the backdrop instead of dimming it — wrong direction for a modal scrim. Needs a theme-independent `scrim`.
4. **`rounded-pill` likely applies no radius.** `radii.pill` is defined in tokens.ts but never emitted (`baseStylesheet` emits md/lg/xl only) nor mapped in `@theme inline`, so `rounded-pill` resolves to an undefined `--radius-pill` → no border-radius. Affects the AiSheet grabber (AiSheet:176), the inventory add-product button (FullScreen:69), and the low-stock badge (FullScreen:102) — they render with square corners instead of pill. *Confidence: medium — inferred from the wiring; not build-verified (build intentionally not run).*

## Parallel sources of truth (duplicates of what tokens.ts should own)

1. **`app-visuals.tsx` `COLOR_CLASSES` (lines 47-52)** — a `color → "bg-x/15 text-x"` string map that duplicates the palette outside tokens.ts. Any token rename (indigo→…) must be mirrored here by hand; it also hard-codes the "/15" tint convention. This is the main parallel palette.
2. **`ThemePicker.tsx:42/46/50`** — reads the raw token object (`tokens.screen/card/indigo`) via inline `style` to render live preview swatches. Not a second list, but a **structural coupling to tokens.ts field names**: renaming `indigo`→`accent` in tokens.ts silently requires editing `tokens.indigo` here (line 50) or the preview breaks.
3. **`radii.pill` vs the CSS layer** — tokens.ts declares `pill: "999px"` but `baseStylesheet()`/`@theme inline` don't expose it. tokens.ts and the wired CSS disagree about what radii exist (dead token on one side, dangling utility on the other).

## Notes / open questions for the conversion round

- Decide whether **brand mark** (Header wordmark) and **selected/active** should both be `accent`, or split (`brand` fixed vs `accent` theme-driven).
- Decide whether **urgency/alert** (notifications) and **destructive** share `danger` or split (`alert` vs `danger`).
- Decide the **app-brand palette** model: fixed hues per app, or theme-driven — this determines whether `app-accent-*` are tokens or a separate fixed table.
- The `/15` subtle-surface convention appears 8×; decide subtle-surface tokens vs continuing alpha-on-accent (alpha may not read consistently across 6 themes).
- No mapping proposed for the final token list (per instructions) — this is the map only.
