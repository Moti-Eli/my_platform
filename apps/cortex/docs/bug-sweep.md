# Cortex — Bug Sweep, Round 1 (Audit)

**Date:** 2026-07-15
**Scope:** `apps/cortex/src` (all 58 `.ts`/`.tsx`/`.css`), the root `docs/Cortex-SubApp-Standard.md` (v1.2), and `apps/cortex/README.md`.
**Method:** read-only. No build, lint, or typecheck run; **no code changed**. Deterministic categories (1, 4, 5-eruda) swept by grep + manual verification; investigative categories (2, 3, 6, 7, 8) swept by parallel readers and the load-bearing findings re-verified by hand.
**This is an audit only — nothing below has been applied.**

---

## Headline

**Zero HIGH findings.** The four highest-risk categories are clean:

- **Silently dead classes (§1): CLEAN** — no default palette class and no default text-size class survives anywhere in the code (only in explanatory comments).
- **Lost shadows / invisible surfaces (§3): CLEAN** — every raised element keeps a real tone step; the old inventory +/- incident is already fixed (`bg-hairline` on screen-toned rows).
- **`.interactive` conversion (§2): CLEAN** — every visible pressable control has it; no decorative element wrongly has it; no double feedback.
- **Six-theme migration (§4): CLEAN** — no `"light"`/`"dark"` theme-name literals survive, the cookie shim covers the only read path, no orphaned i18n keys, nothing assumes exactly two themes.

Everything found is **MEDIUM** (latent / edge-case / locale-specific / misleading-doc) or **LOW** (dead code, stale comments, undocumented conventions). Details below, HIGHs-first as requested.

---

## HIGH

None.

---

## MEDIUM

### M1 — `AppTabsRow` long-press timer has no unmount cleanup
- **Where:** `apps/cortex/src/components/shell/AppTabsRow.tsx:141` (the `setTimeout` in `onPointerDown`; `clearTimer` at ~143–145).
- **What:** The 500 ms long-press timer is cleared on pointer up/cancel/leave/move, but there is **no** `useEffect(() => clearTimer, [])` to clear it on unmount.
- **Why it matters:** If the row unmounts during the 500 ms window (e.g. a chip is held while the shell navigates to a full-bleed route like `/profile` or `/settings`, which unmounts the scroll area — `AppShell.tsx:125`), the timer fires `openMenu → setMenu(...)` on an unmounted component. Under React 19 this is a silent no-op rather than a warning, but the timer still leaks until it fires and writes stale state. Latent.
- **Proposed fix (not applied):** add `useEffect(() => clearTimer, [])`.

### M2 — `FullScreen` (inventory) async `setState` is unguarded
- **Where:** `apps/cortex/src/tools/inventory/views/FullScreen.tsx:26–52` (`refresh`/`changeQuantity` calling `setItems(await …)`; also `setAdding`).
- **What:** The async `refresh()` writes state after `await rt.runIntent(...)` with no `mounted` flag / `AbortController`. Its siblings do guard — `DashboardCard.tsx:28–40` and `cortex/apps.ts:21–35` both use an `alive` flag.
- **Why it matters:** Navigating away from the inventory screen before the intent resolves runs `setItems`/`setAdding` on an unmounted component. No-op under React 19, but it is the exact unguarded-async pattern, and it is **inconsistent** with the guarded siblings. Latent.
- **Proposed fix (not applied):** mirror `DashboardCard` — `let alive = true` in the mount effect and gate the setters.

### M3 — AI history drawer is pinned with a physical `left-0` (breaks in the en/LTR locale)
- **Where:** `apps/cortex/src/components/shell/AiSheet.tsx:515` (`absolute inset-y-0 left-0 … rounded-s-xl`, off-screen via `translateX(-100%)`); swipe math at `AiSheet.tsx:466` (`Math.min(0, dx)`).
- **What:** The drawer is hard-pinned to the physical left and only slides/swipes leftward. The app has a **live he/en toggle** that flips `dir`. In RTL (primary) this is correct; in English/LTR the drawer stays on the left (the *start*) while its `rounded-s-xl` corner *does* flip — so the pin and the rounding disagree, and the open/swipe direction is wrong.
- **Why it matters:** Real visual bug for the English locale (drawer opens from the wrong edge, mismatched rounded corner). Hebrew is unaffected.
- **Proposed fix (not applied):** use `start-0` / `inset-inline-start-0` and a direction-aware translate/ swipe sign.

### M4 — Home placeholder card boxes its list rows (contract §8 violation)
- **Where:** `apps/cortex/src/app/page.tsx:44` (`<li className="… rounded-lg bg-screen px-sm py-sm">` inside the `rounded-lg bg-card p-md` card at `page.tsx:30`).
- **What:** Contract §8: *"List rows inside a card have no fill and no radius — they sit on the card surface, separated by a hairline and spacing. A card is a box; its contents are not."* These rows have **both** a fill (`bg-screen`) **and** a radius (`rounded-lg`).
- **Why it matters:** Diverges from the contract **and** from the reference implementation (`DashboardCard.tsx:59–64` does the same list correctly as flat `divide-y` rows). It's a cosmetic inconsistency in a skeleton preview card — not a functional break, hence MEDIUM not HIGH. (The inventory reference tool itself is fully compliant.)
- **Proposed fix (not applied):** drop `rounded-lg bg-screen` from the `<li>`; match `DashboardCard`'s flat rows.

### M5 — `apps/cortex/README.md` describes the old two-theme / old-token model
- **Where:** `apps/cortex/README.md` lines ~42–43, 45, 50–51, 69, 71–73.
- **What (each contradicts current code):**
  - `:42–43` & `:69` — "`themes` holds `light` (default) and `dark`". Actual model is six themes (abyss/midnight/slate/dawn/quietLight/clay), default **quietLight**.
  - `:45` — lists utilities `bg-indigo`, `shadow-soft`. Neither exists now (semantic `bg-accent`; shadows are `shadow-lifted`/`shadow-hero` only).
  - `:50–51` — palette named as teal/coral/amber with stale values (`#12A08E`/`#F5744F`/`#DE982B`); current quietLight is success `#0F8476`, danger `#DA3A0C`, warning `#A06B19`.
  - `:71–73` — says the app version lives in `package.json` (`0.3.0`) read via `APP_VERSION`; actually `lib/version.ts` hard-codes the running integer `APP_VERSION = "24"`, independent of `package.json`.
- **Why it matters:** A contributor following the README would look for themes/tokens/version mechanics that no longer exist. Actively misleading (docs, not runtime).
- **Proposed fix (not applied):** rewrite the design-system/themes, palette, and version lines to the current model. (Note: `apps/cortex/docs/` itself is **empty** — it holds no stale `.md`; this report is its first file.)

---

## LOW

### Dead code (harmless clutter)
- **Orphaned component — `BrainLogo`** — `apps/cortex/src/components/BrainLogo.tsx:8`. Zero importers anywhere (the header wordmark is text-only now). *Action:* delete the file.
- **Orphaned icon — `SendIcon`** — `apps/cortex/src/components/icons.tsx:88`. Zero importers (the composer uses `ArrowUpIcon`; `common.send` is only an aria-label string). *Action:* delete the export.
- **Dead design-system exports** — used only inside `tokens.ts`, never imported externally:
  - `radii`, `fontSans`, `ThemeTokens` re-exported from `design-system/index.ts` but unimported. 
  - `type` (`tokens.ts:389`) and `space` (`tokens.ts:409`) carry an `export` keyword but are not re-exported and not imported anywhere.
  *Action:* drop from the `index.ts` re-export list / remove the `export` keyword. (Keep `radii`/`space`/`type`/`fontSans` as module-local consts — `baseStylesheet()` still uses them.)
- **Dead i18n keys** — defined in both `he` and `en`, referenced by nothing but JSDoc: `ai.title`, `home.emptyTitle`, `home.emptyHint`, `catalog.emptyTitle`, `catalog.emptyHint` (`i18n/dictionaries.ts`). The AI header uses `tabs.ai`; Home uses `emptyInstalledTitle/Hint`; catalog has no empty branch. *Action:* remove the five keys from both trees.

### Stale comments (not doc files)
- `apps/cortex/src/design-system/tokens.ts:3` — header comment says "rounded **16–24px**", contradicting the tightened radii (10/12/14/18px) defined lower in the same file (`:366`).
- `apps/cortex/src/app/globals.css:6–7` — comment lists `bg-indigo` / `shadow-soft` as example utilities; both are gone.
- `docs/Cortex-SubApp-Standard.md:275` — "Design tokens (color, **radius 16–24**, typography, shadows)" contradicts the actual 10–18px scale (and §8's own "rounded-md/-lg/-xl/-pill" line). Also, §8's binding token list **omits spacing** even though `--ds-space-*` is a full token family the contract claims to govern.
- *Action:* correct the radius numbers; optionally add a spacing clause to §8.

### One raw numeric spacing value
- `apps/cortex/src/components/shell/TabBar.tsx:115` — `-mt-8` (32px) for the center FAB's overlap offset, where a named token exists (`space.xl` = 32px). The lone raw-numeric spacing utility in the app. *Action (optional):* `-mt-xl` if/when a negative named step is wanted; purely a convention slip, renders correctly.

### RTL — likely deliberate, flagged for your call (not assumed)
- `apps/cortex/src/components/shell/AiSheet.tsx:299` — attach popover `absolute bottom-full left-0`. Physical `left-0` makes the menu grow inward (toward screen center) from the end-anchored "+"; `start-0` would grow it further toward the edge and risk clipping. **Read: deliberate**, but could be `start-0` for consistency — your call.
- Not findings (verified deliberate): `BackButton` never flips its chevron (documented, `BackButton.tsx:6`); the `dir="ltr"` islands (wordmark, profile/settings top bar so Back is always left, version number, quantity+unit numerals); `left-1/2 -translate-x-1/2` toast centering; all `scaleX(-1)` chevron flips are `dir`-driven.

### Undocumented-but-sound conventions (code follows, contract doesn't state)
Reported per §6 item 2 — documentation gaps, not bugs:
- **Flat on-screen row list** (`components/profile/SettingsList.tsx`, used by settings/profile): rows sit directly on `bg-screen`, no fill/radius, **no `divide-y`** — grouped by spacing only. The contract's only list-row clause is scoped to rows *inside a card*; this second variant is undocumented. (Correctly uses `.interactive` without `active:scale`, matching "rows do not scale".)
- **ThemePicker inline styles** (`components/settings/ThemePicker.tsx:37,41,45`): `style={{ backgroundColor: tokens.screen/card/accent }}` reads the `themes` registry to render live per-theme swatches — CSS variables only expose the *active* theme, so this can't be a token utility. Legitimate shell infrastructure; worth a one-line carve-out in §8's "never define colours" rule.

### Informational (not bugs)
- `apps/cortex/src/app/catalog/page.tsx:52` — `<div aria-disabled …>` for unavailable apps has no `.interactive`, so the util's disabled dimming doesn't apply; the code dims it manually with `opacity-50`. Correct as-is.
- `components/profile/BackButton.tsx:16` and header/profile back buttons render bare icons (no `bg-card` disc) whereas inventory/notifications back buttons use a disc. Cosmetic consistency only; the bare chevron is fully legible on `bg-screen`.
- Three drag/swipe `<div>`/`<aside>` gesture surfaces in `AiSheet.tsx` (grabber `:168`, header drag `:180`, history swipe `:509`) aren't keyboard-focusable, but every action they perform (close) is reachable via Escape + the labeled scrim/close buttons. No unique action is keyboard-locked.

---

## Per-category clean bill

| # | Category | Result |
|---|---|---|
| 1 | Silently dead classes | **CLEAN** — zero default palette/text-size classes (comment-only hits). |
| 2 | `.interactive` conversion | **CLEAN** — all visible controls covered; no decorative misuse; no double feedback; disabled handling consistent; no real overlay clipping. |
| 3 | Lost shadows / invisible surfaces | **CLEAN** — every raised element keeps a tone step; inventory +/- already fixed. |
| 4 | Six-theme migration | **CLEAN** — no theme-name literals; cookie shim covers the only read path; no orphan keys; nothing assumes two themes. |
| 5 | Dead code | eruda fully removed (not in `package.json`, zero refs). Minor dead exports/components/keys listed under LOW. |
| 6 | Contract vs reality | Inventory reference **fully compliant**. One code violation (M4, placeholder card); contract-text staleness (radius range, missing spacing clause) under LOW. |
| 7 | Accessibility & RTL | a11y **CLEAN** (every icon-only control labeled; no `tabIndex={-1}`; every `outline-none` has a `:focus-visible` replacement). RTL: one MEDIUM (M3) + one deliberate `left-0` flagged. |
| 8 | React correctness | Index-keys **CLEAN** (all reorderable lists use stable ids); no accumulating leaks; listeners all paired. Two MEDIUM latent items (M1, M2). |

---

## Suggested triage order for Round 2

1. **M3** — real visual bug in the en locale (`start-0` + direction-aware swipe).
2. **M1 / M2** — add the two missing async/unmount guards (cheap, removes latent state writes).
3. **M4** — align the Home placeholder rows with the reference/contract.
4. **M5** — refresh `README.md` to the six-theme model.
5. **LOW batch** — delete dead code (`BrainLogo`, `SendIcon`, dead exports, 5 i18n keys), fix the three stale comments/`16–24` radius numbers.

_No changes were made. Version not bumped, per instructions._
