"use client";

/**
 * The candidate card + the tool's shared form primitives (Standard §2 views/).
 * Extracted from FullScreen.tsx as a PURE refactor — rendered output and write
 * paths are identical.
 *
 * OWNERSHIP: this file owns NO data. FullScreen keeps the candidates list, the
 * react-query cache writes and every per-id in-flight guard; the card receives
 * the candidate and callbacks as props and owns only its own local UI state
 * (the edit draft, and whether the archive form is open). Nothing here touches
 * CANDIDATES_LIST_KEY.
 *
 * IMPORT DIRECTION is one-way: FullScreen imports from THIS file (the card,
 * ArchiveForm, TextField, parseTags, the style constants and the shared types)
 * — never the reverse.
 */
import { useEffect, useRef, useState } from "react";
import type { IntentResult } from "@/cortex/actions";
import { useI18n } from "@/i18n";
import { CheckIcon, ComposeIcon, InfoIcon, StarIcon } from "@/components/icons";
import type { Candidate, CandidateStage } from "../logic";

/** The failure codes a write can come back with (from {@link IntentResult}). */
export type WriteErrorCode = Extract<IntentResult, { ok: false }>["code"];

/** Everything the card's EDIT MODE may save — the full editable field set.
 * `urgent` is deliberately absent (the star owns it, live in both modes), and
 * stage/rejectReason go through set_stage, never through an edit save. */
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

/** One read-only card field: caption label over a {@link CardValue}. Fields the
 * SECTION HEADER already names render a bare CardValue instead — never the same
 * string twice. */
function CardField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2xs">
      <span className="type-caption text-muted">{label}</span>
      <CardValue value={value} />
    </div>
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
 * header toggle: one control, two states (ComposeIcon → edit; CheckIcon →
 * save). The draft lives locally and is seeded on entering edit; closing the
 * overlay unmounts the card, so an unsaved draft is discarded with no confirm
 * — by design. Saves go through the parent's saveCandidate (the ONE
 * update_candidate flow with its per-id guard); stage actions delegate to the
 * parent's moveStage — the card never owns a write.
 */
export function CandidateCard({
  candidate,
  nextStage,
  onToggleUrgent,
  onAdvance,
  onArchive,
  onSave,
}: {
  candidate: Candidate;
  nextStage: CandidateStage | undefined;
  onToggleUrgent: () => void;
  onAdvance: (next: CandidateStage) => void;
  onArchive: (reason?: string) => Promise<void>;
  onSave: (patch: CandidatePatch) => Promise<WriteErrorCode | null>;
}) {
  const { t } = useI18n();
  // Whether the archive-reason form is open above the footer (view mode only).
  const [showArchive, setShowArchive] = useState(false);
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

  function enterEdit() {
    setShowArchive(false);
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
      {/* Header: name · role · urgent star · certificate check · edit/save. */}
      <div className="flex items-center gap-sm rounded-lg bg-card p-md">
        <div className="flex min-w-0 flex-1 flex-col gap-2xs">
          <span className="truncate type-heading text-ink">{candidate.name}</span>
          {candidate.role !== "" ? (
            <span className="truncate type-label text-muted">{candidate.role}</span>
          ) : (
            <span aria-hidden="true" className="type-label text-muted">
              —
            </span>
          )}
        </div>

        {/* The star stays LIVE in BOTH modes — it's the same optimistic
            one-field toggle the row has, on the same per-id guard. */}
        <button
          type="button"
          aria-label={t("candidates.urgent")}
          aria-pressed={candidate.urgent}
          onClick={onToggleUrgent}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full interactive motion-safe:active:scale-[0.97] ${
            candidate.urgent ? "bg-app-amber/15 text-app-amber" : "bg-hairline text-muted"
          }`}
        >
          <StarIcon width={16} height={16} />
        </button>

        {/* Certificate mark — display only (stable shape: tinted when held,
            neutral when not). Editable via the checkbox in edit mode. */}
        <span
          aria-label={t("candidates.hasCertificate")}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            candidate.hasCertificate ? "bg-app-blue/10 text-app-blue" : "bg-hairline text-muted"
          }`}
        >
          <CheckIcon width={16} height={16} />
        </span>

        {/* THE EDIT/SAVE TOGGLE (fills the former EDIT-TOGGLE SLOT) — a single
            control, two states: ComposeIcon enters edit; CheckIcon saves and
            returns to view on success. */}
        <button
          type="button"
          aria-label={editing ? t("candidates.save") : t("candidates.editCandidate")}
          onClick={editing ? () => void handleSave() : enterEdit}
          disabled={submitting}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full interactive motion-safe:active:scale-[0.97] ${
            editing ? "bg-app-blue/10 text-app-blue" : "bg-hairline text-muted"
          }`}
        >
          {editing ? (
            <CheckIcon width={16} height={16} />
          ) : (
            <ComposeIcon width={16} height={16} />
          )}
        </button>
      </div>

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
        /* EDIT MODE — every field an input, same recipes as the add form. The
           form's onSubmit covers Enter; the header CheckIcon is the button. */
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
          className="flex flex-col gap-sm rounded-lg bg-card p-md"
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
        </form>
      ) : (
        /* VIEW MODE — the read-only sections. */
        <>
          {/* Contact. */}
          <section className="flex flex-col gap-sm rounded-lg bg-card p-md">
            <h3 className="type-caption text-muted">{t("candidates.sectionContact")}</h3>
            <div className="grid grid-cols-2 gap-sm">
              <CardField label={t("candidates.phoneLabel")} value={candidate.phone} />
              <CardField label={t("candidates.emailLabel")} value={candidate.email} />
              <CardField label={t("candidates.cityLabel")} value={candidate.city} />
            </div>
          </section>

          {/* Details. */}
          <section className="flex flex-col gap-sm rounded-lg bg-card p-md">
            <h3 className="type-caption text-muted">{t("candidates.sectionDetails")}</h3>
            <div className="grid grid-cols-2 gap-sm">
              <CardField
                label={t("candidates.availabilityLabel")}
                value={candidate.availability}
              />
              <CardField
                label={t("candidates.hasCar")}
                value={t(candidate.hasCar ? "candidates.yes" : "candidates.no")}
              />
              <CardField label={t("candidates.salaryLabel")} value={candidate.salaryExpectation} />
            </div>
            {/* Tags — chips (dedupe-free display of what's stored). */}
            <div className="flex min-w-0 flex-col gap-2xs">
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
          </section>

          {/* Impression (free text) + summary. The section header IS the impression
              label, so the impression value renders bare (no duplicated string);
              summary keeps its own label. */}
          <section className="flex flex-col gap-sm rounded-lg bg-card p-md">
            <h3 className="type-caption text-muted">{t("candidates.sectionImpression")}</h3>
            <div className="flex flex-col gap-sm">
              <CardValue value={candidate.impression} />
              <CardField label={t("candidates.summaryLabel")} value={candidate.summary} />
            </div>
          </section>

          {/* Footer — pinned (sticky against the overlay sheet's scroll): stage
              actions through the EXISTING flow + the documents placeholder.
              HIDDEN in edit mode — one clear action there: save. */}
          <div className="sticky bottom-0 flex flex-col gap-sm bg-screen pt-2xs">
            {showArchive ? (
              <ArchiveForm onArchive={onArchive} onCancel={() => setShowArchive(false)} />
            ) : null}
            <div className="flex items-center gap-sm">
              <button
                type="button"
                onClick={() => setShowArchive((v) => !v)}
                className="rounded-md bg-hairline px-md py-sm type-label text-ink interactive motion-safe:active:scale-[0.97]"
              >
                {t("candidates.archive")}
              </button>
              <button
                type="button"
                disabled={nextStage === undefined}
                onClick={() => {
                  if (nextStage !== undefined) onAdvance(nextStage);
                }}
                className={`flex-1 px-md ${primaryButtonClass} disabled:opacity-50`}
              >
                {t("candidates.advance")}
              </button>
              {/* Placeholder — no behavior yet, honestly disabled. */}
              <button
                type="button"
                disabled
                className="rounded-md border border-hairline bg-card px-md py-sm type-label text-muted opacity-50"
              >
                {t("candidates.addDocuments")}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Inline archive form — an OPTIONAL reason then commit. The parent's moveStage
 * owns the write (and its per-id guard), so this stays a dumb controlled input;
 * `disabled` while the tap settles is covered by that guard, not local state. */
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
