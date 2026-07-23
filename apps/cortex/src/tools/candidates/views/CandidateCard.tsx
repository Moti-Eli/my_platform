"use client";

/**
 * The candidate card + the tool's shared form primitives (Standard §2 views/).
 *
 * ART DIRECTION — a professional BUSINESS CARD in STAGE SECTIONS: the identity
 * block (monogram avatar + name) is the moment, on its own surface; below it
 * sit THREE SIBLING SECTIONS of the SAME visual weight — one per pipeline
 * stage (details / acceptance / intake): same surface, same padding, same
 * radius, so they read as three equal blocks, not one real block and two
 * stubs. The section matching the candidate's CURRENT stage carries a quiet
 * app-blue/30 border (archived marks none). A status strip states each boolean
 * attribute EXPLICITLY (check when true, X when false — never
 * hidden-when-false); fields are VALUE-dominant (caption label above, body
 * value below); phone/email are live tel:/mailto: actions; the impression is
 * prose. In edit mode the save affordance is the one loud element on the card.
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
 * ArchiveForm, TextField, parseTags, the style constants and the shared types)
 * — never the reverse.
 */
import { useEffect, useRef, useState } from "react";
import type { IntentResult } from "@/cortex/actions";
import { useI18n } from "@/i18n";
import {
  CheckIcon,
  CloseIcon,
  ComposeIcon,
  InfoIcon,
  MailIcon,
  PaperclipIcon,
  PhoneIcon,
} from "@/components/icons";
import type { Candidate } from "../logic";

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
 * no UI for now), and stage/rejectReason go through set_stage, never through an
 * edit save. */
export type CandidatePatch = Omit<Candidate, "id" | "stage" | "urgent" | "rejectReason">;

/** Parse the comma-separated tags input into a clean string[] — trimmed, empties
 * dropped. */
export function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
}

export const inputClass =
  "w-full rounded-md bg-screen px-sm py-sm type-body text-ink outline-none placeholder:text-muted";
export const invalidRing = "ring-1 ring-danger";
/** The quiet primary action — a subtle accent tint, never a solid fill. */
export const primaryButtonClass =
  "rounded-md bg-app-blue/10 py-sm type-label text-app-blue interactive motion-safe:active:scale-[0.97]";

/** ONE text-field recipe, shared by the add form and the card's edit mode, so
 * the two can never drift apart visually. */
export function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-2xs type-label text-muted">
      {label}
      <input
        className={inputClass}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
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
 * `current` marks the candidate's CURRENT stage with a quiet app-blue/30
 * border; the border is transparent otherwise (not absent), so the geometry
 * never shifts. Archived candidates mark no section. */
function StageSection({
  title,
  current,
  children,
}: {
  title: string;
  current: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`flex flex-col gap-sm rounded-lg border bg-card p-lg ${
        current ? "border-app-blue/30" : "border-transparent"
      }`}
    >
      <h3 className="type-label font-semibold text-ink">{title}</h3>
      {children}
    </section>
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
  tagsRaw: string;
  hasCertificate: boolean;
  hasCar: boolean;
}

/**
 * The candidate card — VIEW mode (read-only) with an EDIT mode behind the
 * header toggle: one control, two states (ComposeIcon → edit; the loud filled
 * save → save). The draft lives locally and is seeded on entering edit; closing
 * the overlay unmounts the card, so an unsaved draft is discarded with no
 * confirm — by design. Saves go through the parent's saveCandidate (the ONE
 * update_candidate flow with its per-id guard) — the card never owns a write.
 * Stage moves and archiving live in the overlay HEADER (FullScreen), not here;
 * `onEditingChange` lifts the ONE "is editing" bit up so that header can
 * disable those controls while a draft is open (the draft itself never leaves
 * this component).
 */
export function CandidateCard({
  candidate,
  onSave,
  onEditingChange,
}: {
  candidate: Candidate;
  onSave: (patch: CandidatePatch) => Promise<WriteErrorCode | null>;
  onEditingChange: (editing: boolean) => void;
}) {
  const { t } = useI18n();
  // EDIT MODE: a non-null draft IS edit mode. Seeded from the candidate when
  // the toggle enters edit; nulled on save success or discarded on unmount.
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const editing = draft !== null;
  // Blank-name-on-save marking (the same visible validation the add form has).
  const [invalidName, setInvalidName] = useState(false);
  // A FAILED save's code, surfaced INSIDE the card — the screen-level alert
  // sits behind the overlay, so it cannot carry this one.
  const [saveError, setSaveError] = useState<WriteErrorCode | null>(null);
  // True while a save is in flight — disables the toggle; the parent's per-id
  // guard backs this up (belt-and-suspenders).
  const [submitting, setSubmitting] = useState(false);

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
    setInvalidName(false);
    setDraft({
      name: candidate.name,
      role: candidate.role,
      phone: candidate.phone,
      city: candidate.city,
      email: candidate.email,
      availability: candidate.availability,
      salaryExpectation: candidate.salaryExpectation,
      summary: candidate.summary,
      impression: candidate.impression,
      // The same round-trip the old inline editor used: chips -> "a, b" -> parseTags.
      tagsRaw: candidate.tags.join(", "),
      hasCertificate: candidate.hasCertificate,
      hasCar: candidate.hasCar,
    });
  }

  const patchDraft = (patch: Partial<CardDraft>) =>
    setDraft((cur) => (cur === null ? cur : { ...cur, ...patch }));

  async function handleSave() {
    if (draft === null || submitting) return;

    const nextName = draft.name.trim();
    setInvalidName(nextName === "");
    if (nextName === "") return;

    setSubmitting(true);
    try {
      const code = await onSave({
        name: nextName,
        role: draft.role.trim(),
        phone: draft.phone.trim(),
        city: draft.city.trim(),
        email: draft.email.trim(),
        availability: draft.availability.trim(),
        salaryExpectation: draft.salaryExpectation.trim(),
        summary: draft.summary.trim(),
        impression: draft.impression.trim(),
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

  return (
    <div className="flex flex-col gap-sm">
      {/* 1 · IDENTITY — its own surface, the business-card moment. */}
      <div className="rounded-lg bg-card">
        {/* Room to breathe. */}
        <div className="flex items-center gap-md p-lg">
          <span
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-app-blue/10 type-title text-app-blue"
          >
            {initialsOf(candidate.name)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2xs">
            <span className="truncate type-title text-ink">{candidate.name}</span>
            {candidate.role !== "" ? (
              <span className="truncate type-body text-muted">{candidate.role}</span>
            ) : (
              <span aria-hidden="true" className="type-body text-muted">
                —
              </span>
            )}
          </div>

          {/* THE EDIT/SAVE TOGGLE — one control, two states. Quiet in view
              mode; in edit mode it is the ONE loud element on the card: solid
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
                : "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-hairline text-muted interactive motion-safe:active:scale-[0.97]"
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
        </div>

        {/* 2 · STATUS STRIP — every boolean stated explicitly, true or false. */}
        <div className="flex flex-wrap items-center gap-2xs px-lg pb-lg">
          <StatusChip label={t("candidates.hasCertificate")} on={candidate.hasCertificate} />
          <StatusChip label={t("candidates.hasCar")} on={candidate.hasCar} />
        </div>
      </div>

      {/* 3 · DETAILS SECTION — the first of the three equal stage sections;
          holds every existing field (and, in edit mode, the document
          placeholders). The candidate's CURRENT stage is marked by the section
          border (see StageSection); archived marks none. */}
      <StageSection title={t("candidates.sectionDetails")} current={candidate.stage === "contact"}>
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
            <label className="flex flex-col gap-2xs type-label text-muted">
              <span>
                {t("candidates.candidateName")}{" "}
                <span aria-hidden="true" className="text-danger">
                  *
                </span>
              </span>
              <input
                className={invalidName ? `${inputClass} ${invalidRing}` : inputClass}
                value={draft.name}
                placeholder={t("candidates.namePlaceholder")}
                onChange={(e) => {
                  patchDraft({ name: e.target.value });
                  if (invalidName) setInvalidName(false);
                }}
                aria-required="true"
                aria-invalid={invalidName}
              />
              {invalidName ? (
                <span role="alert" className="type-caption text-danger">
                  {t("candidates.fieldRequired")}
                </span>
              ) : null}
            </label>
            <TextField
              label={t("candidates.roleLabel")}
              value={draft.role}
              placeholder={t("candidates.rolePlaceholder")}
              onChange={(v) => patchDraft({ role: v })}
            />
            <TextField
              label={t("candidates.phoneLabel")}
              value={draft.phone}
              placeholder={t("candidates.phonePlaceholder")}
              onChange={(v) => patchDraft({ phone: v })}
            />
            <TextField
              label={t("candidates.emailLabel")}
              value={draft.email}
              placeholder={t("candidates.emailPlaceholder")}
              onChange={(v) => patchDraft({ email: v })}
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
          /* VIEW MODE — value-dominant fields, then the impression as prose
             behind the section's ONE hairline rule (its one genuine break). */
          <>
            {/* FIELDS — two columns when the sheet is wide enough. */}
            <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
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
            </div>

            {/* IMPRESSION — prose, not a form field; summary keeps its own
                label beneath it. */}
            <div className="flex flex-col gap-sm border-t border-hairline pt-sm">
              <span className="type-caption text-muted">{t("candidates.sectionImpression")}</span>
              {candidate.impression !== "" ? (
                <p className="whitespace-pre-wrap type-body leading-relaxed text-ink">
                  {candidate.impression}
                </p>
              ) : (
                <span aria-hidden="true" className="type-body text-muted">
                  —
                </span>
              )}
              <CardField label={t("candidates.summaryLabel")} value={candidate.summary} />
            </div>
          </>
        )}
      </StageSection>

      {/* 4/5 · ACCEPTANCE + INTAKE SECTIONS — honest stubs: the same equal
          block as details, a short muted line each, and NO invented fields or
          controls until these stages grow real content. */}
      <StageSection
        title={t("candidates.stageInterview")}
        current={candidate.stage === "interview"}
      >
        <p className="type-caption text-muted">{t("candidates.stageSectionEmpty")}</p>
      </StageSection>
      <StageSection title={t("candidates.stageIntake")} current={candidate.stage === "intake"}>
        <p className="type-caption text-muted">{t("candidates.stageSectionEmpty")}</p>
      </StageSection>
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
