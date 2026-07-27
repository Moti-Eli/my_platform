"use client";

/**
 * The candidate card + the tool's shared form primitives (Standard §2 views/).
 *
 * ART DIRECTION — a professional BUSINESS CARD in STAGE SECTIONS: a MINIMAL
 * identity row (monogram · name · edit + share) sitting bare on the sheet — no
 * surface, no role line, no status chips; those live in the details section,
 * stated once. Below it sit THREE SIBLING SECTIONS of the SAME visual weight —
 * one per pipeline stage (details / acceptance / intake): same surface, same
 * padding, same radius, so they read as three equal blocks, not one real block
 * and two stubs. The section matching the candidate's CURRENT stage carries a
 * quiet app-blue/30 border (archived marks none). Booleans are stated
 * EXPLICITLY (check when true, X when false — never hidden-when-false); fields
 * are VALUE-dominant (caption label above, body value below); phone/email are
 * live tel:/mailto: actions; the impression is prose. In edit mode the save
 * affordance is the one loud element on the card.
 *
 * THE CARD'S EDIT MODE IS THE ONE CANDIDATE FORM: the plus flow opens this
 * same card with a BLANK candidate and `startInEdit` — there is no separate
 * add form. What a save DOES is the parent's decision via `onSave`
 * (create_candidate for a blank card, update_candidate for an existing one);
 * the card only edits and validates.
 *
 * STAGE + ARCHIVE CONTROLS ARE NOT HERE: they moved to the overlay HEADER
 * (FullScreen), which reuses the SAME moveStage flow the card's footer used to
 * call. The card renders no footer; the ArchiveForm below is rendered by
 * FullScreen inside the overlay, opened from that header.
 *
 * OWNERSHIP: this file owns NO data. FullScreen keeps the candidates list, the
 * react-query cache writes and every per-id in-flight guard; the card receives
 * the candidate and callbacks as props and owns only its own local UI state
 * (the edit draft). Nothing here touches CANDIDATES_LIST_KEY.
 *
 * IMPORT DIRECTION is one-way: FullScreen imports from THIS file (the card,
 * ArchiveForm, the stage constants and the shared types) — never the reverse.
 */
import { useEffect, useRef, useState } from "react";
import { runIntentAction, type IntentResult } from "@/cortex/actions";
import { useI18n } from "@/i18n";
import {
  CheckIcon,
  CloseIcon,
  ComposeIcon,
  CopyIcon,
  InfoIcon,
  LockIcon,
  MailIcon,
  PaperclipIcon,
  PhoneIcon,
  SendIcon,
  ShareIcon,
} from "@/components/icons";
import type { Candidate, QuestionnaireAnswer } from "../logic";

/** The stages the tool SHOWS, in pipeline order. `archived` is deliberately
 * absent: it exists in the DB and intents, it just has no tab and no segment.
 * Exported so the top bar (FullScreen) and the card's stage control share one
 * definition. */
export const VISIBLE_STAGES = ["contact", "interview", "intake"] as const;
export type VisibleStage = (typeof VISIBLE_STAGES)[number];

/** VISIBLE stage → its i18n label key. Shared by the top bar, the card and the
 * dashboard card. No `archived` entry — archived has no tab/segment; its one
 * label (the drawer) reads `candidates.stageArchived` directly. */
export const STAGE_LABEL_KEY = {
  contact: "candidates.stageContact",
  interview: "candidates.stageInterview",
  intake: "candidates.stageIntake",
} as const;

/** The failure codes a write can come back with (from {@link IntentResult}). */
export type WriteErrorCode = Extract<IntentResult, { ok: false }>["code"];

/** Everything the card's EDIT MODE may save — the full editable field set.
 * `urgent` is deliberately absent (the flag lives on in the data layer but has
 * no UI for now), stage/rejectReason go through set_stage, and `candidateUserId`
 * is read-only (written only by the invite sequence) — none are edit-savable. */
export type CandidatePatch = Omit<
  Candidate,
  "id" | "stage" | "urgent" | "rejectReason" | "candidateUserId"
>;

/** Parse the comma-separated tags input into a clean string[] — trimmed, empties
 * dropped. */
function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
}

const inputClass =
  "w-full rounded-md bg-screen px-sm py-sm type-body text-ink outline-none placeholder:text-muted/50";
const invalidRing = "ring-1 ring-danger";
/** The quiet primary action — a subtle accent tint, never a solid fill. */
const primaryButtonClass =
  "rounded-md bg-app-blue/10 py-sm type-label text-app-blue interactive motion-safe:active:scale-[0.97]";

/** The details section's REQUIRED contact fields — all four must be non-empty
 * before the acceptance (קבלה) stage unlocks. They carry visible validation in
 * edit mode (the same recipe the name field used to have alone). */
const REQUIRED_FIELDS = ["name", "role", "phone", "email"] as const;
type RequiredField = (typeof REQUIRED_FIELDS)[number];

/** ONE text-field recipe for the card's edit mode — the single candidate form
 * now that the separate add form is gone. Optionally REQUIRED: a `*` on the
 * label, a danger ring while `invalid`, and the shared "required" message —
 * exactly the treatment the name field carried before the four contact fields
 * joined it. */
function TextField({
  label,
  value,
  placeholder,
  onChange,
  required = false,
  invalid = false,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  required?: boolean;
  invalid?: boolean;
}) {
  const { t } = useI18n();
  return (
    <label className="flex flex-col gap-2xs type-label text-muted">
      <span>
        {label}
        {required ? (
          <>
            {" "}
            <span aria-hidden="true" className="text-danger">
              *
            </span>
          </>
        ) : null}
      </span>
      <input
        className={invalid ? `${inputClass} ${invalidRing}` : inputClass}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
      />
      {required && invalid ? (
        <span role="alert" className="type-caption text-danger">
          {t("candidates.fieldRequired")}
        </span>
      ) : null}
    </label>
  );
}

/** The monogram initials: first letters of the first two words of the name —
 * works for Hebrew exactly as for Latin (first characters, no casing games).
 * Exported so the row monograms (FullScreen) share the exact same recipe. */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("");
}

/** A read-only card value: the text, or an em-dash (muted) when empty — every
 * field always renders, so the card shape is stable. */
function CardValue({ value }: { value: string }) {
  return value !== "" ? (
    <span className="break-words type-body text-ink">{value}</span>
  ) : (
    <span aria-hidden="true" className="type-body text-muted">
      —
    </span>
  );
}

/** One read-only card field, VALUE-dominant: small caption label above, the
 * body-sized value below — the label is metadata, the value is the content. */
function CardField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2xs">
      <span className="type-caption text-muted">{label}</span>
      <CardValue value={value} />
    </div>
  );
}

/** A contact field whose value is an ACTION (tel:/mailto:) — text-app-blue with
 * a small glyph, clearly distinguishable from inert text. Empty stays the plain
 * muted em-dash, no link. */
function ContactField({
  label,
  value,
  href,
  icon,
}: {
  label: string;
  value: string;
  href: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2xs">
      <span className="type-caption text-muted">{label}</span>
      {value !== "" ? (
        <a
          href={href}
          className="inline-flex items-center gap-2xs break-all type-body text-app-blue interactive motion-safe:active:scale-[0.99]"
        >
          {icon}
          {value}
        </a>
      ) : (
        <span aria-hidden="true" className="type-body text-muted">
          —
        </span>
      )}
    </div>
  );
}

/** One status chip: the attribute name plus an EXPLICIT mark — check when true,
 * X when false. Never hidden-when-false; the sr-only yes/no carries the state
 * for assistive tech (the icon alone is visual). */
function StatusChip({ label, on }: { label: string; on: boolean }) {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center gap-2xs rounded-pill px-xs py-2xs type-caption ${
        on ? "bg-success/10 text-success" : "bg-hairline text-muted"
      }`}
    >
      {label}
      {on ? <CheckIcon width={12} height={12} /> : <CloseIcon width={12} height={12} />}
      <span className="sr-only">{t(on ? "candidates.yes" : "candidates.no")}</span>
    </span>
  );
}

/** One stage section — all three render through this ONE recipe so they can
 * never drift into unequal blocks: same surface, same padding, same radius.
 * `current` marks the candidate's CURRENT (derived) stage with a quiet
 * app-blue/30 border; the border is transparent otherwise (not absent), so the
 * geometry never shifts. `locked` mutes a stage that its predecessor hasn't
 * unlocked yet (a locked section is never the current stage, so the two states
 * never collide). Archived candidates mark no section. */
function StageSection({
  title,
  current,
  locked = false,
  children,
}: {
  title: string;
  current: boolean;
  locked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`flex flex-col gap-sm rounded-lg border bg-card p-lg ${
        current ? "border-app-blue/30" : "border-transparent"
      } ${locked ? "opacity-60" : ""}`}
    >
      <h3 className="type-label font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

/** The muted hint shown INSIDE a locked stage section — a small padlock glyph
 * plus one line telling the user to finish the previous stage. It replaces the
 * section's field entirely while locked (nothing editable leaks through). */
function LockedHint() {
  const { t } = useI18n();
  return (
    <p className="flex items-center gap-2xs type-caption text-muted">
      <LockIcon width={14} height={14} aria-hidden className="shrink-0" />
      {t("candidates.stageLocked")}
    </p>
  );
}

/** The card edit mode's draft — every editable field as input state (tags as
 * the raw comma-separated text). null draft = VIEW mode. */
interface CardDraft {
  name: string;
  role: string;
  phone: string;
  city: string;
  email: string;
  availability: string;
  salaryExpectation: string;
  summary: string;
  impression: string;
  acceptanceNote: string;
  intakeNote: string;
  tagsRaw: string;
  hasCertificate: boolean;
  hasCar: boolean;
}

/** Seed an edit draft from a candidate — used both by the edit toggle and by
 * `startInEdit` (the blank-card create flow), so the two can never drift. */
function draftOf(candidate: Candidate): CardDraft {
  return {
    name: candidate.name,
    role: candidate.role,
    phone: candidate.phone,
    city: candidate.city,
    email: candidate.email,
    availability: candidate.availability,
    salaryExpectation: candidate.salaryExpectation,
    summary: candidate.summary,
    impression: candidate.impression,
    acceptanceNote: candidate.acceptanceNote,
    intakeNote: candidate.intakeNote,
    // The same round-trip the old inline editor used: chips -> "a, b" -> parseTags.
    tagsRaw: candidate.tags.join(", "),
    hasCertificate: candidate.hasCertificate,
    hasCar: candidate.hasCar,
  };
}

/**
 * The candidate card — VIEW mode (read-only) with an EDIT mode behind the
 * header toggle: one control, two states (ComposeIcon → edit; the loud filled
 * save → save). The draft lives locally and is seeded on entering edit — or at
 * MOUNT when `startInEdit` is set (the plus flow: a blank candidate, straight
 * into the form); closing the overlay unmounts the card, so an unsaved draft
 * is discarded with no confirm — by design. Saves go through the parent's
 * `onSave` (update_candidate for an existing candidate, create_candidate for a
 * blank one — the parent decides; the card never owns a write). Stage moves
 * and archiving live in the overlay HEADER (FullScreen), not here;
 * `onEditingChange` lifts the ONE "is editing" bit up so that header can
 * disable those controls while a draft is open (the draft itself never leaves
 * this component).
 */
export function CandidateCard({
  candidate,
  startInEdit = false,
  onSave,
  onEditingChange,
  headerActions,
  archivePanel,
}: {
  candidate: Candidate;
  startInEdit?: boolean;
  onSave: (patch: CandidatePatch) => Promise<WriteErrorCode | null>;
  onEditingChange: (editing: boolean) => void;
  /** Overlay-owned controls (archive/restore + the close X) slotted into the
   * END of the ONE header row — they live in FullScreen because their handlers
   * need the overlay's state, but they belong on the card's single header line. */
  headerActions?: React.ReactNode;
  /** The archive-reason form (FullScreen-owned), rendered directly under the
   * header row when open — null/absent otherwise. */
  archivePanel?: React.ReactNode;
}) {
  const { t } = useI18n();
  // EDIT MODE: a non-null draft IS edit mode. Seeded from the candidate when
  // the toggle enters edit (or at mount, for the blank-card create flow);
  // nulled on save success or discarded on unmount. Lazy initializer: read once
  // at mount — a later `startInEdit` change never re-seeds a live draft.
  const [draft, setDraft] = useState<CardDraft | null>(() =>
    startInEdit ? draftOf(candidate) : null,
  );
  const editing = draft !== null;
  // Which REQUIRED contact fields failed the last save attempt (name/role/
  // phone/email). Marked on save, cleared per-field as the user types — the
  // same visible validation the name field alone used to carry.
  const [invalidFields, setInvalidFields] = useState<ReadonlySet<RequiredField>>(new Set());
  // A FAILED save's code, surfaced INSIDE the card — the screen-level alert
  // sits behind the overlay, so it cannot carry this one.
  const [saveError, setSaveError] = useState<WriteErrorCode | null>(null);
  // True while a save is in flight — disables the toggle; the parent's per-id
  // guard backs this up (belt-and-suspenders).
  const [submitting, setSubmitting] = useState(false);

  // INVITE (candidates.invite) — the card's OWN server action, independent of the
  // edit/save flow. `invitePending` disables the button while it runs; on success
  // we hold the returned link to show the copy panel; on failure a code we map to a
  // specific line. `linkRef` lets the copy fallback (non-secure origins with no
  // navigator.clipboard) select the text for a manual/legacy copy.
  const [invitePending, setInvitePending] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<WriteErrorCode | null>(null);
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLTextAreaElement>(null);

  // Guard the post-await setState: the overlay can unmount this card mid-save.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Lift the ONE "is editing" signal to the parent: FullScreen disables the
  // overlay header's stage/archive controls while a draft is open, because a
  // stage move mid-edit closes the overlay and would silently discard the
  // draft. An effect (not calls sprinkled into enterEdit/handleSave) so every
  // transition — enter, save success — reports exactly once.
  useEffect(() => {
    onEditingChange(editing);
  }, [editing, onEditingChange]);

  function enterEdit() {
    setSaveError(null);
    setInvalidFields(new Set());
    setDraft(draftOf(candidate));
  }

  const patchDraft = (patch: Partial<CardDraft>) =>
    setDraft((cur) => (cur === null ? cur : { ...cur, ...patch }));

  // Clear one required field's invalid mark as the user types into it (no-op if
  // it wasn't marked), so the danger ring disappears the moment it's satisfied.
  const clearInvalid = (field: RequiredField) =>
    setInvalidFields((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });

  async function handleSave() {
    if (draft === null || submitting) return;

    // All four contact fields are REQUIRED — mark every empty one and abort if
    // any is missing (the acceptance stage's unlock depends on them too).
    const trimmed: Record<RequiredField, string> = {
      name: draft.name.trim(),
      role: draft.role.trim(),
      phone: draft.phone.trim(),
      email: draft.email.trim(),
    };
    const missing = new Set<RequiredField>(REQUIRED_FIELDS.filter((f) => trimmed[f] === ""));
    setInvalidFields(missing);
    if (missing.size > 0) return;

    setSubmitting(true);
    try {
      const code = await onSave({
        name: trimmed.name,
        role: trimmed.role,
        phone: trimmed.phone,
        city: draft.city.trim(),
        email: trimmed.email,
        availability: draft.availability.trim(),
        salaryExpectation: draft.salaryExpectation.trim(),
        summary: draft.summary.trim(),
        // impression is a normal DETAILS field again (its own free text); the two
        // per-stage notes are the acceptance (קבלה) and intake (קליטה) fields.
        impression: draft.impression.trim(),
        acceptanceNote: draft.acceptanceNote.trim(),
        intakeNote: draft.intakeNote.trim(),
        tags: parseTags(draft.tagsRaw),
        hasCertificate: draft.hasCertificate,
        hasCar: draft.hasCar,
      });
      if (!mounted.current) return;
      if (code === null) {
        // Success → back to view mode. The cache already holds the saved values.
        setDraft(null);
        setSaveError(null);
      } else {
        // Failure → STAY in edit mode with the draft intact (nothing is lost),
        // surface the code inline. The parent already reverted the cache.
        setSaveError(code);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  // Run candidates.invite for THIS candidate. Idempotent server-side: "invite" and
  // "re-send link" are the SAME call — the button label differs only by whether a
  // user is already linked. Success holds the returned link; failure holds the code.
  async function handleInvite() {
    if (invitePending) return;
    setInvitePending(true);
    setInviteError(null);
    try {
      const res = await runIntentAction("candidates.invite", { candidateId: candidate.id });
      if (!mounted.current) return;
      if (res.ok) {
        setInviteLink((res.data as { link: string }).link);
        setInviteError(null);
        setCopied(false);
      } else {
        setInviteError(res.code);
        setInviteLink(null);
      }
    } finally {
      if (mounted.current) setInvitePending(false);
    }
  }

  // Copy the link. Prefer the async Clipboard API; on a NON-SECURE origin it is
  // absent, so fall back to selecting the text + the legacy execCommand copy, and
  // if even that throws, leave the text selected so the user can copy by hand.
  async function copyLink() {
    if (inviteLink === null) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteLink);
      } else {
        linkRef.current?.select();
        document.execCommand("copy");
      }
      if (mounted.current) {
        setCopied(true);
        window.setTimeout(() => {
          if (mounted.current) setCopied(false);
        }, 2000);
      }
    } catch {
      linkRef.current?.select();
    }
  }

  // Effective values for the completeness gates: the LIVE draft while editing,
  // the saved candidate otherwise — so the stage tiers unlock (and the accent
  // moves) as you type, and reflect what's stored when viewing.
  const effective = draft ?? candidate;
  // "פרטי קשר" is complete once all four required contact fields are non-empty.
  const contactComplete =
    effective.name.trim() !== "" &&
    effective.role.trim() !== "" &&
    effective.phone.trim() !== "" &&
    effective.email.trim() !== "";
  // קבלה's one field is `acceptanceNote` (the real column now). קליטה unlocks
  // once it is filled — the SAME signal the server's deriveStage reads, so this
  // client accent and the persisted stage always agree.
  const acceptanceComplete = contactComplete && effective.acceptanceNote.trim() !== "";
  // A LOCKED section shows only the lock hint and edits nothing.
  const acceptanceLocked = !contactComplete;
  const intakeLocked = !acceptanceComplete;
  // Derived stage — the section that carries the app-blue current-stage accent.
  // Reads the SAME fields (contact four + acceptanceNote) the server's deriveStage
  // uses on save, so the accent shown here is exactly what gets persisted: all
  // four contact + acceptanceNote filled → intake; all four contact → interview;
  // otherwise → contact.
  const derivedStage: VisibleStage = acceptanceComplete
    ? "intake"
    : contactComplete
      ? "interview"
      : "contact";

  return (
    <div className="flex flex-col gap-sm">
      {/* 1 · HEADER — the ONE thin header row (the overlay no longer paints a
          second row above it). RTL: monogram + name at the START (right), then
          the action icons — share · edit/save · archive/restore — then the
          close X at the far END (left). `headerActions` carries the
          overlay-owned controls (archive/restore + close X, which need
          FullScreen's state); share and the edit/save toggle are the card's
          own. No surface, no box. Role and the status booleans are NOT repeated
          here — they are fields in the details section. */}
      <div className="sticky top-0 z-10 flex items-center gap-sm bg-screen px-sm pt-sm pb-2xs">
        {/* Monogram — a future profile photo replaces the initials with an
            <img> inside this same overflow-hidden wrapper. */}
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-app-blue/10 type-label text-app-blue"
        >
          {initialsOf(candidate.name)}
        </span>
        <span className="min-w-0 flex-1 truncate type-title text-ink">{candidate.name}</span>

        {/* SHARE — honest disabled placeholder until sharing exists; a bare
            muted glyph (no disc), title + aria-label carry the name for hover
            and screen readers. */}
        <button
          type="button"
          disabled
          title={t("candidates.share")}
          aria-label={t("candidates.share")}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted opacity-50"
        >
          <ShareIcon width={16} height={16} />
        </button>

        {/* INVITE — provision (or re-send a link for) the candidate's login
            portal. Shown ONLY for a SAVED, non-archived candidate: hidden in
            create mode (no id yet, nothing to invite) and for archived rows (the
            server refuses them anyway). Idempotent, so the SAME control both
            invites and re-sends — only the label changes with candidateUserId.
            Bare glyph like the other header controls; pulses while pending. */}
        {candidate.id !== "" && candidate.stage !== "archived" ? (
          <button
            type="button"
            title={t(candidate.candidateUserId ? "candidates.inviteResend" : "candidates.invite")}
            aria-label={t(candidate.candidateUserId ? "candidates.inviteResend" : "candidates.invite")}
            disabled={invitePending}
            onClick={() => void handleInvite()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted interactive hover:bg-hairline active:bg-hairline disabled:opacity-50 motion-safe:active:scale-[0.97]"
          >
            <SendIcon
              width={16}
              height={16}
              className={invitePending ? "motion-safe:animate-pulse" : undefined}
            />
          </button>
        ) : null}

        {/* THE EDIT/SAVE TOGGLE — one control, two states. A BARE glyph in
            view mode (no disc; rounded-full only shapes the faint hover/press
            tint); in edit mode it is the ONE loud element on the card: solid
            success fill, icon + label, gently pulsing until pressed (still,
            and disabled, while the save runs). */}
        <button
          type="button"
          aria-label={editing ? t("candidates.save") : t("candidates.editCandidate")}
          onClick={editing ? () => void handleSave() : enterEdit}
          disabled={submitting}
          className={
            editing
              ? `flex h-9 shrink-0 items-center gap-2xs rounded-pill bg-success px-sm type-label text-on-fill interactive disabled:opacity-50 motion-safe:active:scale-[0.97] ${
                  submitting ? "" : "motion-safe:animate-pulse"
                }`
              : "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted interactive hover:bg-hairline active:bg-hairline motion-safe:active:scale-[0.97]"
          }
        >
          {editing ? (
            <>
              <CheckIcon width={16} height={16} />
              {t("candidates.save")}
            </>
          ) : (
            <ComposeIcon width={16} height={16} />
          )}
        </button>

        {/* OVERLAY-OWNED CONTROLS — archive/restore then the close X (X last, so
            it sits at the far end). Rendered by FullScreen (their handlers need
            the overlay's state) and slotted in here so the whole header is ONE
            row. */}
        {headerActions}
      </div>

      {/* The archive-reason form, when open — slotted directly under the header
          row (FullScreen-owned; see archivePanel). */}
      {archivePanel}

      {/* INVITE RESULT — the link BUBBLE is the whole panel: the readonly link
          fills it, with two BARE floating glyphs inside — copy on the RIGHT
          (inline-start in RTL), a close X on the LEFT (inline-end) that hides the
          panel. A one-line hint sits below. Or a mapped error line instead.
          CSS-CASCADE CAUTION: `.interactive` overrides position utilities, so the
          `absolute` lives on a plain SPAN wrapper, NEVER on the button; the bubble
          is a plain `relative` div. Logical start/end insets flip correctly in RTL. */}
      {inviteLink !== null ? (
        <div className="flex flex-col gap-xs">
          <div className="relative rounded-lg bg-card">
            {/* px-xl reserves an inline gutter on BOTH edges so the link text never
                runs under either floating glyph; bg-transparent lets the bubble
                surface show through. */}
            <textarea
              ref={linkRef}
              readOnly
              dir="ltr"
              value={inviteLink}
              rows={2}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full resize-none break-all rounded-lg bg-transparent px-xl py-sm type-caption text-ink outline-none"
            />
            {/* COPY — RIGHT side (inline-start in RTL). Bare glyph; swaps to a check
                on success (the only copied feedback now that the label is gone). */}
            <span className="absolute top-2 start-2">
              <button
                type="button"
                onClick={() => void copyLink()}
                title={t(copied ? "candidates.inviteCopied" : "candidates.inviteCopy")}
                aria-label={t(copied ? "candidates.inviteCopied" : "candidates.inviteCopy")}
                className="flex items-center justify-center text-muted interactive motion-safe:active:scale-[0.97]"
              >
                {copied ? <CheckIcon width={14} height={14} /> : <CopyIcon width={14} height={14} />}
              </button>
            </span>
            {/* CLOSE — LEFT side (inline-end in RTL). Hides the result panel. */}
            <span className="absolute top-2 end-2">
              <button
                type="button"
                onClick={() => {
                  setInviteLink(null);
                  setCopied(false);
                }}
                title={t("candidates.cancel")}
                aria-label={t("candidates.cancel")}
                className="flex items-center justify-center text-muted interactive motion-safe:active:scale-[0.97]"
              >
                <CloseIcon width={14} height={14} />
              </button>
            </span>
          </div>
          <p className="type-caption text-muted">{t("candidates.inviteHint")}</p>
        </div>
      ) : inviteError !== null ? (
        <p
          role="alert"
          className="flex items-start gap-xs rounded-md bg-danger/10 px-sm py-xs type-label text-danger"
        >
          <InfoIcon width={18} height={18} aria-hidden className="mt-2xs shrink-0" />
          <span>
            {t(
              inviteError === "missingEmail"
                ? "candidates.inviteErrorMissingEmail"
                : inviteError === "archived"
                  ? "candidates.inviteErrorArchived"
                  : inviteError === "emailExists"
                    ? "candidates.inviteErrorEmailExists"
                    : inviteError === "provisionFailed"
                      ? "candidates.inviteErrorProvisionFailed"
                      : "candidates.inviteErrorFailed",
            )}
          </span>
        </p>
      ) : null}

      {/* 3 · DETAILS SECTION (פרטי קשר) — the first of the three equal stage
          sections; holds every existing field (and, in edit mode, the document
          placeholders). Its four contact fields (name/role/phone/email) are
          REQUIRED and gate the acceptance stage below. The derived current
          stage is marked by the section border (see StageSection). */}
      <StageSection title={t("candidates.sectionDetails")} current={derivedStage === "contact"}>
        {/* A failed save, surfaced inside the card (see saveError above). */}
        {editing && saveError ? (
          <p
            role="alert"
            className="flex items-start gap-xs rounded-md bg-danger/10 px-sm py-xs type-label text-danger"
          >
            <InfoIcon width={18} height={18} aria-hidden className="mt-2xs shrink-0" />
            <span>
              {t(saveError === "failed" ? "candidates.errorFailed" : "candidates.errorDenied")}
            </span>
          </p>
        ) : null}

        {editing && draft !== null ? (
          /* EDIT MODE — every field an input, same recipes as the add form, on
             the section's own surface (no box-in-box). The form's onSubmit
             covers Enter; the identity block's save control is the button. */
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave();
            }}
            className="flex flex-col gap-sm"
          >
            {/* The four REQUIRED contact fields — name/role/phone/email — each
                carrying the shared required-field validation. Non-empty on all
                four is exactly what unlocks the acceptance stage below. */}
            <TextField
              label={t("candidates.candidateName")}
              value={draft.name}
              placeholder={t("candidates.namePlaceholder")}
              onChange={(v) => {
                patchDraft({ name: v });
                clearInvalid("name");
              }}
              required
              invalid={invalidFields.has("name")}
            />
            <TextField
              label={t("candidates.roleLabel")}
              value={draft.role}
              placeholder={t("candidates.rolePlaceholder")}
              onChange={(v) => {
                patchDraft({ role: v });
                clearInvalid("role");
              }}
              required
              invalid={invalidFields.has("role")}
            />
            <TextField
              label={t("candidates.phoneLabel")}
              value={draft.phone}
              placeholder={t("candidates.phonePlaceholder")}
              onChange={(v) => {
                patchDraft({ phone: v });
                clearInvalid("phone");
              }}
              required
              invalid={invalidFields.has("phone")}
            />
            <TextField
              label={t("candidates.emailLabel")}
              value={draft.email}
              placeholder={t("candidates.emailPlaceholder")}
              onChange={(v) => {
                patchDraft({ email: v });
                clearInvalid("email");
              }}
              required
              invalid={invalidFields.has("email")}
            />
            <TextField
              label={t("candidates.cityLabel")}
              value={draft.city}
              placeholder={t("candidates.cityPlaceholder")}
              onChange={(v) => patchDraft({ city: v })}
            />
            <TextField
              label={t("candidates.availabilityLabel")}
              value={draft.availability}
              placeholder={t("candidates.availabilityPlaceholder")}
              onChange={(v) => patchDraft({ availability: v })}
            />
            <TextField
              label={t("candidates.salaryLabel")}
              value={draft.salaryExpectation}
              placeholder={t("candidates.salaryPlaceholder")}
              onChange={(v) => patchDraft({ salaryExpectation: v })}
            />
            <TextField
              label={t("candidates.summaryLabel")}
              value={draft.summary}
              placeholder={t("candidates.summaryPlaceholder")}
              onChange={(v) => patchDraft({ summary: v })}
            />
            {/* IMPRESSION — a normal optional DETAILS field (free-text prose),
                back in its own home now that the per-stage notes have real
                columns. It is NOT a stage field and does not gate anything. */}
            <label className="flex flex-col gap-2xs type-label text-muted">
              {t("candidates.impressionLabel")}
              <textarea
                className={`${inputClass} min-h-24 resize-y`}
                value={draft.impression}
                placeholder={t("candidates.impressionPlaceholder")}
                rows={3}
                onChange={(e) => patchDraft({ impression: e.target.value })}
              />
            </label>
            <TextField
              label={t("candidates.tagsLabel")}
              value={draft.tagsRaw}
              placeholder={t("candidates.tagsPlaceholder")}
              onChange={(v) => patchDraft({ tagsRaw: v })}
            />
            <div className="flex items-center gap-md">
              <label className="flex items-center gap-xs type-label text-muted">
                <input
                  type="checkbox"
                  checked={draft.hasCertificate}
                  onChange={(e) => patchDraft({ hasCertificate: e.target.checked })}
                  className="h-4 w-4"
                />
                {t("candidates.hasCertificate")}
              </label>
              <label className="flex items-center gap-xs type-label text-muted">
                <input
                  type="checkbox"
                  checked={draft.hasCar}
                  onChange={(e) => patchDraft({ hasCar: e.target.checked })}
                  className="h-4 w-4"
                />
                {t("candidates.hasCar")}
              </label>
            </div>

            {/* DOCUMENTS — edit mode only, the end of the details section:
                legible upload affordances (dashed hairline, paperclip),
                honestly disabled until uploads exist. */}
            <div className="flex items-center gap-sm">
              <button
                type="button"
                disabled
                className="flex flex-1 items-center justify-center gap-2xs rounded-md border border-dashed border-hairline px-sm py-xs type-caption text-muted opacity-50"
              >
                <PaperclipIcon width={14} height={14} />
                {t("candidates.uploadCv")}
              </button>
              <button
                type="button"
                disabled
                className="flex flex-1 items-center justify-center gap-2xs rounded-md border border-dashed border-hairline px-sm py-xs type-caption text-muted opacity-50"
              >
                <PaperclipIcon width={14} height={14} />
                {t("candidates.uploadDoc")}
              </button>
            </div>
          </form>
        ) : (
          /* VIEW MODE — value-dominant fields. The impression is NOT shown here
             anymore: it is the acceptance stage's field now (see that section). */
          <>
            {/* FIELDS — two columns when the sheet is wide enough. Role leads:
                it moved here from the old identity header (stated once). */}
            <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
              <CardField label={t("candidates.roleLabel")} value={candidate.role} />
              <ContactField
                label={t("candidates.phoneLabel")}
                value={candidate.phone}
                href={`tel:${candidate.phone}`}
                icon={<PhoneIcon width={14} height={14} className="shrink-0" />}
              />
              <ContactField
                label={t("candidates.emailLabel")}
                value={candidate.email}
                href={`mailto:${candidate.email}`}
                icon={<MailIcon width={14} height={14} className="shrink-0" />}
              />
              <CardField label={t("candidates.cityLabel")} value={candidate.city} />
              <CardField
                label={t("candidates.availabilityLabel")}
                value={candidate.availability}
              />
              <CardField label={t("candidates.salaryLabel")} value={candidate.salaryExpectation} />
              {/* STATUS — the booleans, stated explicitly either way (moved
                  here from the old identity header; said ONCE, in details). */}
              <div className="flex flex-wrap items-center gap-2xs sm:col-span-2">
                <StatusChip label={t("candidates.hasCertificate")} on={candidate.hasCertificate} />
                <StatusChip label={t("candidates.hasCar")} on={candidate.hasCar} />
              </div>
              {/* Tags — chips (dedupe-free display of what's stored). */}
              <div className="flex min-w-0 flex-col gap-2xs sm:col-span-2">
                <span className="type-caption text-muted">{t("candidates.tagsLabel")}</span>
                {candidate.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-2xs">
                    {candidate.tags.map((tag, i) => (
                      <span
                        key={`${tag}-${i}`}
                        className="rounded-pill bg-hairline px-xs py-2xs type-caption text-muted"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span aria-hidden="true" className="type-body text-muted">
                    —
                  </span>
                )}
              </div>
              {/* Summary — full-width. */}
              <div className="sm:col-span-2">
                <CardField label={t("candidates.summaryLabel")} value={candidate.summary} />
              </div>
              {/* Impression — a normal optional details field again, shown as
                  prose (its own free text; NOT a stage field). */}
              <div className="flex min-w-0 flex-col gap-2xs sm:col-span-2">
                <span className="type-caption text-muted">{t("candidates.impressionLabel")}</span>
                {candidate.impression !== "" ? (
                  <p className="whitespace-pre-wrap type-body leading-relaxed text-ink">
                    {candidate.impression}
                  </p>
                ) : (
                  <span aria-hidden="true" className="type-body text-muted">
                    —
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </StageSection>

      {/* 4 · ACCEPTANCE SECTION (קבלה) — LOCKED until all four contact fields
          are non-empty; then it shows its ONE field, the real `acceptanceNote`
          column (20260723000006). Filling it is what moves the candidate to
          'intake' — the server's deriveStage reads this exact field on save. */}
      <StageSection
        title={t("candidates.stageInterview")}
        current={derivedStage === "interview"}
        locked={acceptanceLocked}
      >
        {acceptanceLocked ? (
          <LockedHint />
        ) : editing && draft !== null ? (
          <label className="flex flex-col gap-2xs type-label text-muted">
            {t("candidates.acceptanceNoteLabel")}
            <textarea
              className={`${inputClass} min-h-24 resize-y`}
              value={draft.acceptanceNote}
              placeholder={t("candidates.acceptanceNotePlaceholder")}
              rows={3}
              onChange={(e) => patchDraft({ acceptanceNote: e.target.value })}
            />
          </label>
        ) : candidate.acceptanceNote !== "" ? (
          <p className="whitespace-pre-wrap type-body leading-relaxed text-ink">
            {candidate.acceptanceNote}
          </p>
        ) : (
          <span aria-hidden="true" className="type-body text-muted">
            —
          </span>
        )}
      </StageSection>

      {/* 5 · INTAKE SECTION (קליטה) — LOCKED until the acceptance field above is
          non-empty; then it shows its ONE field, the real `intakeNote` column
          (20260723000006). A live field now, the SAME recipe as the קבלה field —
          no longer a disabled placeholder. */}
      <StageSection
        title={t("candidates.stageIntake")}
        current={derivedStage === "intake"}
        locked={intakeLocked}
      >
        {intakeLocked ? (
          <LockedHint />
        ) : (
          <>
            {/* The intake note field — UNCHANGED (edit textarea / prose / em-dash). */}
            {editing && draft !== null ? (
              <label className="flex flex-col gap-2xs type-label text-muted">
                {t("candidates.intakeNoteLabel")}
                <textarea
                  className={`${inputClass} min-h-24 resize-y`}
                  value={draft.intakeNote}
                  placeholder={t("candidates.intakeNotePlaceholder")}
                  rows={3}
                  onChange={(e) => patchDraft({ intakeNote: e.target.value })}
                />
              </label>
            ) : candidate.intakeNote !== "" ? (
              <p className="whitespace-pre-wrap type-body leading-relaxed text-ink">
                {candidate.intakeNote}
              </p>
            ) : (
              <span aria-hidden="true" className="type-body text-muted">
                —
              </span>
            )}

            {/* THE CANDIDATE'S QUESTIONNAIRE ANSWERS — only once they are LINKED
                (candidateUserId set); nothing extra otherwise. Lazily fetched when
                this bubble renders (see CandidateAnswers). */}
            {candidate.candidateUserId ? <CandidateAnswers candidateId={candidate.id} /> : null}
          </>
        )}
      </StageSection>
    </div>
  );
}

/** The candidate's questionnaire answers, READ-ONLY, inside the intake bubble.
 * Rendered only for a LINKED candidate (the parent gates on candidateUserId). It
 * LAZILY runs `candidates.answers` when it mounts — i.e. when the intake bubble is
 * shown — so the read costs nothing for candidates who were never invited.
 *
 * Each answer is a muted question label above the answer as body text; an
 * unanswered question shows the em-dash placeholder, exactly like the card's empty
 * fields. A non-privileged caller gets zero rows (correct, not an error) and this
 * renders nothing. */
function CandidateAnswers({ candidateId }: { candidateId: string }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [answers, setAnswers] = useState<QuestionnaireAnswer[]>([]);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    void (async () => {
      const res = await runIntentAction("candidates.answers", { candidateId });
      if (!active) return;
      if (res.ok) {
        setAnswers((res.data as { answers: QuestionnaireAnswer[] }).answers);
        setStatus("ready");
      } else {
        setStatus("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [candidateId]);

  // Ready with nothing to show (a caller who may not read the rows) → render nothing,
  // so no empty titled block appears.
  if (status === "ready" && answers.length === 0) return null;

  return (
    <div className="flex flex-col gap-sm border-t border-hairline pt-sm">
      <span className="type-caption text-muted">{t("candidates.answersTitle")}</span>
      {status === "loading" ? (
        <div className="flex flex-col gap-xs" aria-hidden="true">
          <span className="h-4 w-full rounded-md bg-hairline motion-safe:animate-pulse" />
          <span className="h-4 w-3/4 rounded-md bg-hairline motion-safe:animate-pulse" />
        </div>
      ) : status === "error" ? (
        <p className="type-caption text-muted">{t("candidates.answersLoadFailed")}</p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {answers.map((a) => (
            <li key={a.questionKey} className="flex min-w-0 flex-col gap-2xs">
              <span className="type-caption text-muted">{a.questionText}</span>
              {a.answer.trim() !== "" ? (
                <p className="whitespace-pre-wrap type-body leading-relaxed text-ink">{a.answer}</p>
              ) : (
                <span aria-hidden="true" className="type-body text-muted">
                  —
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Inline archive form — an OPTIONAL reason then commit. Rendered by FullScreen
 * inside the overlay (opened from the header's archive control). The parent's
 * moveStage owns the write (and its per-id guard), so this stays a dumb
 * controlled input; `disabled` while the tap settles is covered by that guard,
 * not local state. */
export function ArchiveForm({
  onArchive,
  onCancel,
}: {
  onArchive: (reason?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = reason.trim();
    void onArchive(next === "" ? undefined : next);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-sm rounded-lg bg-card p-md">
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("candidates.rejectReason")}
        <input
          className={inputClass}
          value={reason}
          placeholder={t("candidates.rejectReasonPlaceholder")}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="flex items-center gap-sm">
        <button type="submit" className={`flex-1 ${primaryButtonClass}`}>
          {t("candidates.archive")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md bg-hairline px-md py-sm type-label text-ink interactive motion-safe:active:scale-[0.97]"
        >
          {t("candidates.cancel")}
        </button>
      </div>
    </form>
  );
}
