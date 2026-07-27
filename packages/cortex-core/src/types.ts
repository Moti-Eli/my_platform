/**
 * Cortex shared contract types (Cortex-SubApp-Standard.md, Section 1).
 *
 * These are the ONLY shapes the core exposes to sub-apps. A tool never talks to
 * the shell (or to other tools) directly — it communicates strictly through:
 *   - Intents   (directed requests: "do this and give me that"), and
 *   - Events    (fire-and-forget chain reactions),
 * both carrying a ready-made {@link Ctx} supplied by the shell.
 *
 * NOTE: this core prompt builds the engine only (registry + data-layer +
 * event-bus + the four shell tables). Sub-apps and the full tool-file template
 * (Standard §2) are intentionally NOT built here — Section 1 is used solely to
 * define the types below.
 */

import type { ZodType } from "zod";

/**
 * The execution context the shell hands to every intent handler and event
 * listener. A handler NEVER fetches this itself — identity and tenant are
 * resolved by the shell up front (Standard §7).
 *
 * - `userId`     the acting user (mirrors `auth.users.id` / `public.users.id`).
 * - `orgId`      the active organization. THE ONLY SCOPING KEY. Never null.
 * - `instanceId` audit metadata ONLY. Never a scoping key. Null until
 *                installed-apps moves off localStorage.
 * - `isAdmin`    admin status in the active org. A convenience, not a gate of
 *                record — the DB still enforces access.
 */
export interface Ctx {
  userId: string;

  /**
   * The active organization — and the ONLY axis anything is scoped by.
   *
   * NOT NULLABLE, because the schema does not admit null: every Cortex table
   * carries `org_id NOT NULL` (`inventory_items`, `events`, and — since
   * 20260717000002 — `ai_log`). There is no org-less context to represent:
   * every user has a personal organization, so "no org" is not a state that can
   * occur. A `string | null` here would only invite a null to be written into a
   * NOT NULL column and fail at the database, one layer too late.
   */
  orgId: string;

  /**
   * The `app_instances.id` this call came from — AUDIT METADATA ONLY.
   * "Which installed tool did this", nothing more.
   *
   * IT IS NEVER A SCOPING KEY. Partitioning data by instance is DEAD: branches
   * and tabs are CHILD ORGANIZATIONS (20260716000002 dropped `instance_id` from
   * the tool tables entirely and rebuilt them org-scoped). `orgId` is the only
   * scoping key there is. If you find yourself filtering or writing rows by
   * `instanceId`, the model has been misread.
   *
   * NULLABLE, and null in practice today. It survives only on the two audit
   * columns that deliberately kept it — `events.emitted_by_instance` and
   * `ai_log.target_instance_id` — both nullable, both FK to `app_instances` with
   * ON DELETE SET NULL. `app_instances` currently has ZERO rows, so any non-null
   * value here would violate those FKs the moment a real adapter lands. It stays
   * null until installed-apps moves off localStorage and real instance rows exist.
   */
  instanceId: string | null;

  /**
   * Admin status in the ACTIVE org — derived from `roles.is_admin` (via
   * `membership_roles`) for the caller's membership in `orgId`. A CONVENIENCE the
   * shell reads to gate admin-only UI/intents, nothing more.
   *
   * NOT A SCOPING KEY: `orgId` remains the only axis anything is scoped by. And
   * NOT A SUBSTITUTE FOR RLS: the database still enforces every access row-by-row
   * (auth_user_can_read / _write); this flag only lets the shell decide what to
   * OFFER, never what the DB will ALLOW. Reading it true does not widen access.
   */
  isAdmin: boolean;
}

/**
 * A translation reference. Per Standard §1 law 6 ("design & language are
 * consumed, not invented"), a tool supplies an i18n *key* for its display name
 * rather than a hard-coded string; the shell resolves it through `@platform/i18n`.
 */
export interface LocalizedKey {
  key: string;
}

/**
 * Availability / lifecycle status of an app in the catalog. When absent it is
 * treated as `"ready"` — a real, working tool.
 *
 * - `"ready"`        a real tool with working intents/UI.
 * - `"coming_soon"`  installable, but opens a placeholder view (a stub).
 * - `"unavailable"`  listed in the catalog but not installable yet (a stub).
 */
export type AppStatus = "ready" | "coming_soon" | "unavailable";

/**
 * The fixed set of catalog groupings a tool can belong to. A closed union, not a
 * free string: the upcoming roles-management screen groups tools by category, so
 * the set must be enumerable and every manifest must name one of these exactly.
 */
export type ToolCategory = "people" | "productivity" | "finance" | "operations" | "personal";

/**
 * A tool's manifest — its self-description and the contract surface it declares.
 * Persisted as the `manifest` JSONB on `app_definitions` and registered in the
 * in-memory {@link registerApp | registry} at startup.
 */
export interface AppManifest {
  /** Stable app id / slug. Also the prefix of every intent name (`<id>.<action>`). */
  id: string;
  /** Semver of the tool; it upgrades independently of the shell (§1 law 2). */
  version: string;
  /** Display name as an i18n key (§1 law 6). */
  name: LocalizedKey;
  /** Catalog grouping — a fixed, typed set (see {@link ToolCategory}). */
  category: ToolCategory;
  /** Icon identifier from the central design-system (§1 law 6). */
  icon: string;
  /** Color token from the central palette (§1 law 6). */
  color: string;
  /** Permission keys this tool's intents require (enforced via the data-layer). */
  permissions: string[];
  /** Role names this tool understands. */
  roles: string[];
  /**
   * The visibility a NEW record of this tool is born with — the tool's position
   * on the org/private axis, declared explicitly so it can never be a silent
   * default. Only `"org"` or `"private"`: `"restricted"` is a per-record grant
   * escalation (record_grants), never a birth default — a row born restricted
   * with no grants is invisible.
   *
   * NOTE — currently INERT at the write path. Nothing stamps this onto inserts
   * yet; the DB column default ('org') still applies. It matches reality only
   * because every tool declares "org" today. Declaring "private" will NOT take
   * effect until a later change stamps visibility from the manifest on insert
   * (and wires auth_user_can_read for that tool). Do not declare "private" until
   * then — it would fail closed (invisible), not private.
   */
  defaultVisibility: "org" | "private";
  /** Ids of other apps/capabilities this tool needs present. */
  requires: string[];
  /** Event types this tool may emit. */
  emits: string[];
  /** Event types this tool subscribes to. */
  listensTo: string[];
  /** AI topics this tool exposes through the one door. */
  aiTopics: string[];
  /**
   * TEMP scaffolding flag. `true` marks a not-yet-real app: it registers a
   * normal manifest but renders a placeholder view instead of real intents/UI.
   * A real tool omits this (or sets it `false`). Removed per-app as tools land.
   */
  stub?: boolean;
  /**
   * Availability status (see {@link AppStatus}). Absent ⇒ `"ready"`. Drives
   * whether the catalog lets the user install the app.
   */
  status?: AppStatus;
  /** When true, only an org admin may open this tool. Absent ⇒ open to all
      members. Enforced in three places: the catalog dims+locks the card, the
      tool's own route re-checks isAdmin server-side, and RLS enforces the
      underlying writes. UI+route are convenience/defence-in-depth; RLS is the
      real boundary. */
  requiresAdmin?: boolean;
}

/**
 * A directed request into a tool. The `input`/`output` zod schemas are the hard
 * boundary the data-layer validates on the way in and out (Standard §7).
 *
 * `handler` deliberately receives only `(input, ctx)` — never a db client
 * through its signature. A tool that needs the database closes over a db client
 * provided when its module is constructed (§7: "never writes SQL except via a
 * provided db client"), keeping this shape identical to the Standard.
 *
 * @typeParam TInput  the validated input the handler receives.
 * @typeParam TOutput the value the handler returns (re-validated by `output`).
 */
export interface Intent<TInput = unknown, TOutput = unknown> {
  /** Always `<appId>.<action>` (Standard §7). The appId prefix is enforced at registration. */
  name: string;
  /** Human/AI-readable description of what the intent does. */
  description: string;
  /** Zod schema validating the input before the handler runs. */
  input: ZodType<TInput>;
  /** Zod schema validating the handler's result before it is returned. */
  output: ZodType<TOutput>;
  /**
   * The tool's implementation. Declared as a method (not an arrow property) so
   * the heterogeneous registry can hold `Intent`s of differing input/output
   * types; type-safety is recovered at runtime by the zod `parse` calls.
   */
  handler(input: TInput, ctx: Ctx): Promise<TOutput>;
}

/**
 * A subscription to an event type. Listeners are fire-and-forget: they return
 * `void`, and the emitter is fully decoupled from them (Standard §7).
 *
 * @typeParam TPayload the event payload shape this listener expects.
 */
export interface Listener<TPayload = unknown> {
  /** The event type to react to (e.g. `inventory.item_low`). */
  eventType: string;
  /** Runs when a matching event is emitted, with the emitter's {@link Ctx}. */
  handler(payload: TPayload, ctx: Ctx): Promise<void>;
}

/**
 * The registry and event-bus are heterogeneous: they hold intents/listeners
 * from many tools, each with its own input/output/payload types, and there is
 * no single static type that unifies them. These aliases make that erasure
 * explicit. The `any` is justified (CLAUDE.md rule 3) because type-safety is
 * re-established at the boundary — `runIntent` re-validates every input and
 * output through the intent's own zod schemas.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyIntent = Intent<any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyListener = Listener<any>;
