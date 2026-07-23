"use client";

/**
 * Candidates full screen (Standard §2 `views/FullScreen.tsx`, §8). Data layer
 * cloned from Notes' full screen; the LAYOUT is stage TABS, and its restrained
 * treatment is the visual baseline for the other tools.
 *
 * TOP BAR — one row, one family of five: back chevron · three numbered stage
 * tabs (contact / interview / intake — `archived` stays real in the DB/intents
 * but gets NO tab) · icon-only add. Only the ACTIVE tab's candidates render.
 *
 * ROWS are compact CARDS (bg-card, hairline border, spaced apart — separate
 * objects, no dividers): monogram · name · role · status marks · phone · city ·
 * first summary line, plus the two-tap delete. Tapping a
 * row opens the CANDIDATE CARD (see CandidateCard.tsx) in the same overlay
 * shell the add form uses. STAGE ACTIONS (advance/archive) live ONLY in that
 * overlay's HEADER now — the segmented stage control and the icon-only
 * archive/restore control both reuse the EXISTING set_stage flow (`moveStage`
 * + its per-id guard); no duplicated write logic.
 *
 * TONE: quiet. The accent is used sparingly — subtle `bg-app-blue/10` +
 * `text-app-blue` tints for the active tab, primary submits and the certificate
 * mark; every other surface sits on the neutral roles (bg-card / text-ink /
 * text-muted / hairline). No solid accent fills.
 *
 * WRITES (all owned HERE, never by the card): the read is the SHARED
 * react-query cache (`useCandidatesList`, queryKey ["candidates","list"]) — the
 * same entry the dashboard card reads — and each write reconciles that cache
 * via setQueryData (no refetch), OPTIMISTICALLY with snapshot-revert on
 * failure. Writes flow runIntentAction -> the server data-layer -> the RLS
 * client, gated ROW BY ROW by `private.auth_user_can_write`; failures surface
 * honestly, never faked and never swallowed. Per-id in-flight guards: stage /
 * save / delete each hold their own lock.
 *
 * Built from design-system utilities + i18n only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import {
  BoxIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronIcon,
  CloseIcon,
  InfoIcon,
  PlusIcon,
} from "@/components/icons";
import type { Candidate, CandidateStage } from "../logic";
import { useCandidatesList, CANDIDATES_LIST_KEY } from "@/lib/query/useCandidatesList";
import {
  ArchiveForm,
  CandidateCard,
  STAGE_LABEL_KEY,
  TextField,
  VISIBLE_STAGES,
  initialsOf,
  inputClass,
  invalidRing,
  parseTags,
  primaryButtonClass,
  type CandidatePatch,
  type VisibleStage,
  type WriteErrorCode,
} from "./CandidateCard";

/** Muted placeholder block (same skeleton token recipe as the dashboard card). */
const SKELETON = "rounded-md bg-hairline motion-safe:animate-pulse";

// userId/orgId arrive as props (the page called requireSession()) but are NOT
// sent to the action — the server derives identity from the session cookie. They
// stay in the prop type only because the page provides them; `_props` marks them
// deliberately unused.
export function FullScreen(_props: ToolViewProps) {
  const { t, dir } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  // The READ: straight from the shared query cache — this screen is a reader of the
  // SAME entry the dashboard card reads. It renders from the cache (the single
  // source of truth) and writes back into it via setQueryData, so the two views can
  // never hold diverging copies. Arriving from the card, the cache is warm and the
  // list paints instantly; react-query revalidates in the background.
  const { candidates, isLoading: loading, isError: loadError } = useCandidatesList();
  // Which stage tab is active. Only its candidates render.
  const [activeStage, setActiveStage] = useState<VisibleStage>("contact");
  const [adding, setAdding] = useState(false);
  // Which candidate's CARD is open (null = none). Resolved against the live cache
  // each render, so a write made from the card is reflected immediately.
  const [viewingId, setViewingId] = useState<string | null>(null);
  // Whether the card overlay's ARCHIVE-REASON form is open. Lives HERE (not in
  // the card) because its toggle is the overlay HEADER's archive control; reset
  // whenever a card opens or closes so it never leaks across candidates.
  const [cardArchiveOpen, setCardArchiveOpen] = useState(false);
  // Whether the open card is in EDIT mode — lifted from the card via
  // onEditingChange (the draft itself stays in the card). While true, the
  // header's stage + archive controls are DISABLED (muted, not removed): a
  // stage move mid-edit closes the overlay and would silently discard the
  // draft. The close X stays enabled — discarding via X is by-design.
  const [cardEditing, setCardEditing] = useState(false);
  // Whether the archive drawer (below the list) is open. Local UI state only.
  const [archiveOpen, setArchiveOpen] = useState(false);
  // Set when a write actually FAILS. Distinguishes the honest cases: "denied" /
  // "unavailable" (the DB refused — you may not) vs "failed" (something broke).
  // Never a silent no-op, and never a pretend-success.
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);
  // Guards the async setState in the WRITE callbacks below: they resolve after an
  // await, so a navigation away before they settle must not set component state on
  // an unmounted component. (Cache writes via queryClient are safe either way — and
  // are intentionally NOT gated on this, so a write still reconciles the shared
  // cache even if this screen has since unmounted.)
  const mounted = useRef(true);
  useEffect(() => {
    // Re-arm on every (re)mount. Under StrictMode React runs mount → cleanup →
    // mount; setting `true` here (not only `false` in cleanup) means the second
    // mount re-enables the guard instead of leaving it permanently disarmed,
    // which would swallow every later setState and strand the view empty.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // In-flight STAGE moves and card-edit SAVES — SEPARATE per-id guards, same
  // shape, so a stage move and a save never share a lock.
  const stagingRef = useRef<Set<string>>(new Set());
  const savingRef = useRef<Set<string>>(new Set());

  // In-flight DELETES, keyed by candidate id — a SEPARATE guard from the sets
  // above, mirrored into state so rows can disable while their delete runs.
  const deletingRef = useRef<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(deletingRef.current);
  // Which row is mid two-tap delete confirm (null = none). Tapping a different row's
  // trash moves the confirm there; a second tap on the SAME row commits the delete.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Patch one row in the shared cache by id. Functional updater, so concurrent
  // in-flight writes compose instead of clobbering. `prev ?? []` because the cache
  // can momentarily be undefined (a write racing ahead of the first read).
  const patchCandidate = useCallback(
    (id: string, patch: (it: Candidate) => Candidate) => {
      queryClient.setQueryData<Candidate[]>(CANDIDATES_LIST_KEY, (prev) =>
        (prev ?? []).map((it) => (it.id === id ? patch(it) : it)),
      );
    },
    [queryClient],
  );

  // The card's edit-mode save — the same optimistic discipline as every other
  // write here (the per-id guard, the snapshot, the optimistic patch, the
  // revert), through the EXISTING update_candidate intent. Returns the failure
  // code (null = success) so the card can stay in edit mode with the draft
  // intact on failure.
  const saveCandidate = useCallback(
    async (id: string, patch: CandidatePatch): Promise<WriteErrorCode | null> => {
      // 0. GUARD: one save per row at a time. Unreachable in practice (the card
      //    disables its save control while submitting) — belt-and-suspenders.
      if (savingRef.current.has(id)) return null;

      const prevList = queryClient.getQueryData<Candidate[]>(CANDIDATES_LIST_KEY) ?? [];
      const prev = prevList.find((it) => it.id === id) ?? null;

      savingRef.current = new Set(savingRef.current).add(id);

      // 1. OPTIMISTIC: the shared cache takes the edit first, so the card, the
      //    row and the dashboard card all move in lockstep.
      setWriteError(null);
      patchCandidate(id, (it) => ({ ...it, ...patch }));

      try {
        const res = await runIntentAction("candidates.update_candidate", { id, ...patch });
        if (res.ok) return null;
        // 2. REVERT + hand the code back — the CARD surfaces it (the screen
        //    alert would be hidden behind the overlay).
        if (prev) patchCandidate(id, () => prev);
        return res.code;
      } finally {
        const cleared = new Set(savingRef.current);
        cleared.delete(id);
        savingRef.current = cleared;
      }
    },
    [patchCandidate, queryClient],
  );

  const moveStage = useCallback(
    async (id: string, stage: CandidateStage, rejectReason?: string) => {
      // 0. GUARD: one stage move per row at a time (its own lock — see above).
      if (stagingRef.current.has(id)) return;

      const prevList = queryClient.getQueryData<Candidate[]>(CANDIDATES_LIST_KEY) ?? [];
      const prev = prevList.find((it) => it.id === id) ?? null;

      stagingRef.current = new Set(stagingRef.current).add(id);

      // 1. OPTIMISTIC: move the row to its new stage immediately (it leaves the
      //    active tab's filter in the same render). Mirrors the server's setStage:
      //    archiving writes rejectReason (defaulting to ''), any other move leaves
      //    the stored reason untouched.
      setWriteError(null);
      patchCandidate(id, (it) => ({
        ...it,
        stage,
        rejectReason: stage === "archived" ? (rejectReason ?? "") : it.rejectReason,
      }));

      try {
        const res = await runIntentAction("candidates.set_stage", {
          id,
          stage,
          ...(stage === "archived" ? { rejectReason } : {}),
        });
        // 2. On success: nothing to reconcile — the optimistic move stands.
        if (!res.ok) {
          // 3. REVERT + surface.
          if (prev) patchCandidate(id, () => prev);
          if (mounted.current) setWriteError(res.code);
        }
      } finally {
        const cleared = new Set(stagingRef.current);
        cleared.delete(id);
        stagingRef.current = cleared;
      }
    },
    [patchCandidate, queryClient],
  );

  const removeCandidate = useCallback(
    async (id: string) => {
      // 0. GUARD double-delete: ignore a delete for a row whose delete is already
      //    running.
      if (deletingRef.current.has(id)) return;

      // Snapshot the row AND its index from the cache BEFORE removing, so a failure
      // can restore it exactly where it was.
      const prevList = queryClient.getQueryData<Candidate[]>(CANDIDATES_LIST_KEY) ?? [];
      const index = prevList.findIndex((it) => it.id === id);
      const removed = index >= 0 ? prevList[index] : null;

      const nextDeleting = new Set(deletingRef.current).add(id);
      deletingRef.current = nextDeleting;
      setDeleting(nextDeleting);

      // 1. OPTIMISTIC: drop the row from the SHARED cache immediately, so the
      //    dashboard card (reading the same cache) drops it in lockstep.
      setWriteError(null);
      queryClient.setQueryData<Candidate[]>(CANDIDATES_LIST_KEY, (prev) =>
        (prev ?? []).filter((it) => it.id !== id),
      );

      try {
        const res = await runIntentAction("candidates.delete_candidate", { id });
        // 2. On success: leave it removed — nothing to reconcile.
        if (!res.ok) {
          // 3. REVERT: re-insert the removed row at its original position and
          //    surface the error via the existing writeError alert. The cache is
          //    written only on these chosen paths, so a failure leaves it consistent.
          if (removed) {
            queryClient.setQueryData<Candidate[]>(CANDIDATES_LIST_KEY, (prev) => {
              const list = [...(prev ?? [])];
              list.splice(Math.min(index, list.length), 0, removed);
              return list;
            });
          }
          if (mounted.current) setWriteError(res.code);
        }
      } finally {
        const cleared = new Set(deletingRef.current);
        cleared.delete(id);
        deletingRef.current = cleared;
        if (mounted.current) setDeleting(cleared);
      }
    },
    [queryClient],
  );

  // Only the active tab's candidates render.
  const items = candidates.filter((it) => it.stage === activeStage);
  // Archived candidates — already in the shared list (query_list returns every
  // stage); the drawer below the list is their only surface, since archived
  // has no stage tab.
  const archived = candidates.filter((it) => it.stage === "archived");
  // The card's candidate, resolved from the LIVE cache (not a snapshot) so
  // writes made from the card render immediately.
  const viewing = viewingId ? (candidates.find((it) => it.id === viewingId) ?? null) : null;
  // The ONE close path for the card overlay — every dismissal (X, scrim,
  // Escape, a stage move) goes through here so the archive form and the edit
  // flag never stay set across candidates.
  const closeCard = () => {
    setViewingId(null);
    setCardArchiveOpen(false);
    setCardEditing(false);
  };

  return (
    <>
      {/* TOP BAR — one row: a light back chevron (start = right in RTL), ONE
          segmented stage control spanning the middle (hairline track, the
          active segment raised by sitting lighter on it — no borders, no
          shadow), and a light add icon (end). Deliberately no taller than the
          app tabs row above it. On narrow screens the segments SHRINK and
          truncate their labels — the control never scrolls or breaks. */}
      <div className="flex items-center gap-xs">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label={t("candidates.back")}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted interactive hover:bg-hairline active:bg-hairline motion-safe:active:scale-[0.97]"
        >
          {/* Points RIGHT in RTL (the flip), LEFT in LTR — always "back". */}
          <ChevronIcon style={{ transform: dir === "rtl" ? "scaleX(-1)" : undefined }} />
        </button>

        <div
          role="tablist"
          aria-label={t("candidates.name")}
          className="flex h-9 min-w-0 flex-1 items-center gap-2xs rounded-lg bg-hairline p-2xs"
        >
          {VISIBLE_STAGES.map((stage) => {
            const active = activeStage === stage;
            // The per-stage count, from the already-loaded shared list. Always
            // shown, 0 included — the bar is the pipeline summary.
            const count = candidates.filter((it) => it.stage === stage).length;
            return (
              <button
                key={stage}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveStage(stage)}
                className={`flex h-full min-w-0 flex-1 items-center justify-center gap-2xs rounded-md px-2xs interactive motion-safe:active:scale-[0.97] ${
                  active ? "bg-card text-app-blue" : "text-muted"
                }`}
              >
                <span className={`min-w-0 truncate type-label ${active ? "font-semibold" : ""}`}>
                  {t(STAGE_LABEL_KEY[stage])}
                </span>
                {/* The count stays SECONDARY to the label in both states. */}
                <span
                  className={`shrink-0 type-caption ${
                    active ? "text-app-blue opacity-60" : "text-muted"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setAdding(true)}
          aria-label={t("candidates.addCandidate")}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted interactive hover:bg-hairline active:bg-hairline motion-safe:active:scale-[0.97]"
        >
          <PlusIcon width={20} height={20} />
        </button>
      </div>

      {writeError ? (
        <p
          role="alert"
          className="flex items-start gap-xs rounded-md bg-danger/10 px-sm py-xs type-label text-danger"
        >
          <InfoIcon width={18} height={18} aria-hidden className="mt-2xs shrink-0" />
          <span>
            {t(writeError === "failed" ? "candidates.errorFailed" : "candidates.errorDenied")}
          </span>
        </p>
      ) : null}

      {adding ? (
        <CandidateFormOverlay title={t("candidates.addCandidate")} onClose={() => setAdding(false)}>
          <AddCandidateForm
            onCreated={(candidate) => {
              // create_candidate returns { id }; the rest of the row is exactly what
              // we submitted (plus the DB's defaults: stage 'contact', not urgent, no
              // reject reason), so append it straight into the SHARED cache — no
              // refetch, and the dashboard card sees the new candidate immediately.
              queryClient.setQueryData<Candidate[]>(CANDIDATES_LIST_KEY, (prev) => [
                ...(prev ?? []),
                candidate,
              ]);
              setAdding(false);
              setWriteError(null);
              // New rows land in 'contact'; show them.
              setActiveStage("contact");
            }}
            onError={(code) => setWriteError(code)}
          />
        </CandidateFormOverlay>
      ) : null}

      {/* THE CANDIDATE CARD — view + edit modes in the SAME overlay shell the
          add form uses (see CandidateCard.tsx), with a CUSTOM header replacing
          the title row: close X · the segmented stage control · the icon-only
          archive/restore control. No visible title — the card's identity block
          already shows the name; `title` stays as the dialog's aria-label.
          Stage actions reuse the existing moveStage handler (and its per-id
          guard); the card closes optimistically with the write — on failure the
          row reverts and the screen-level alert reports it. */}
      {viewing ? (
        <CandidateFormOverlay
          title={t("candidates.cardTitle")}
          onClose={closeCard}
          header={
            <div className="flex items-center gap-xs">
              <button
                type="button"
                aria-label={t("candidates.cancel")}
                onClick={closeCard}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card text-muted interactive motion-safe:active:scale-[0.97]"
              >
                <CloseIcon width={18} height={18} />
              </button>

              {/* STAGE CONTROL — the footer's segmented recipe, moved up here
                  (h-8, hairline track, active = bg-card text-app-blue).
                  Tapping ANY segment moves the candidate there through the ONE
                  existing moveStage/set_stage flow (its per-id guard included);
                  tapping the current stage is a no-op. On an archived candidate
                  no segment is active. DISABLED (muted, layout unchanged) while
                  the card is in edit mode — a stage move closes the overlay and
                  would silently discard the draft. */}
              <div
                className={`flex h-8 min-w-0 flex-1 items-center gap-2xs rounded-lg bg-hairline p-2xs ${
                  cardEditing ? "opacity-50" : ""
                }`}
              >
                {VISIBLE_STAGES.map((stage) => {
                  const active = viewing.stage === stage;
                  return (
                    <button
                      key={stage}
                      type="button"
                      aria-pressed={active}
                      disabled={cardEditing}
                      onClick={() => {
                        if (!active) {
                          void moveStage(viewing.id, stage);
                          closeCard();
                        }
                      }}
                      className={`flex h-full min-w-0 flex-1 items-center justify-center rounded-md px-2xs interactive motion-safe:active:scale-[0.97] ${
                        active ? "bg-card text-app-blue" : "text-muted"
                      }`}
                    >
                      <span
                        className={`min-w-0 truncate type-caption ${active ? "font-semibold" : ""}`}
                      >
                        {t(STAGE_LABEL_KEY[stage])}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* ARCHIVE / RESTORE — icon-only; title + aria-label carry the
                  name for hover and screen readers. Archive toggles the reason
                  form below the header; restore is the same set_stage flow the
                  footer used (→ contact). Disabled while editing, same reason
                  as the stage control. */}
              {viewing.stage === "archived" ? (
                <button
                  type="button"
                  title={t("candidates.restore")}
                  aria-label={t("candidates.restore")}
                  disabled={cardEditing}
                  onClick={() => {
                    void moveStage(viewing.id, "contact");
                    closeCard();
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted interactive hover:bg-hairline active:bg-hairline disabled:opacity-50 motion-safe:active:scale-[0.97]"
                >
                  <BoxIcon width={16} height={16} />
                </button>
              ) : (
                <button
                  type="button"
                  title={t("candidates.archive")}
                  aria-label={t("candidates.archive")}
                  aria-expanded={cardArchiveOpen}
                  disabled={cardEditing}
                  onClick={() => setCardArchiveOpen((v) => !v)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted interactive hover:bg-hairline active:bg-hairline disabled:opacity-50 motion-safe:active:scale-[0.97]"
                >
                  <BoxIcon width={16} height={16} />
                </button>
              )}
            </div>
          }
        >
          {cardArchiveOpen ? (
            <ArchiveForm
              onArchive={(reason) => {
                const write = moveStage(viewing.id, "archived", reason);
                closeCard();
                return write;
              }}
              onCancel={() => setCardArchiveOpen(false)}
            />
          ) : null}
          <CandidateCard
            candidate={viewing}
            onSave={(patch) => saveCandidate(viewing.id, patch)}
            onEditingChange={setCardEditing}
          />
        </CandidateFormOverlay>
      ) : null}

      {loading ? (
        // Skeleton on the very first load only (cache empty); arriving from the
        // card the cache is warm and this never shows. Same card shape as rows.
        <ul className="flex flex-col gap-sm" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <li
              key={i}
              className="flex items-center justify-between rounded-lg border border-hairline bg-card p-md"
            >
              <span className={`h-4 w-36 ${SKELETON}`} />
              <span className={`h-4 w-16 ${SKELETON}`} />
            </li>
          ))}
        </ul>
      ) : loadError ? (
        <p className="type-label text-muted">{t("candidates.loadFailed")}</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-xs rounded-lg bg-card px-lg py-2xl text-center">
          <p className="type-heading text-ink">{t("candidates.emptyTitle")}</p>
          <p className="max-w-[24ch] type-label text-muted">{t("candidates.emptyHint")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-sm">
          {items.map((candidate) => {
            const rowDeleting = deleting.has(candidate.id);
            const confirming = confirmId === candidate.id;
            // The compact contact line: phone · city (only the present parts —
            // an empty field omits its separator, never a stray dot).
            const contactLine = [candidate.phone, candidate.city]
              .filter((part) => part !== "")
              .join(" · ");
            // First line of the summary only — the row is compact; the card has
            // the rest. (No stage number here: the row only ever renders inside
            // its own stage tab, so it would be redundant.)
            const summaryLine = candidate.summary.split("\n")[0] ?? "";

            return (
              // Each row is its OWN CARD — a separate object, spaced from its
              // neighbours (the list's gap), no dividers, THIN: a scannable
              // list item, not a card with air in it. Stage actions are NOT
              // here: they live inside the candidate card only.
              <li
                key={candidate.id}
                className="flex items-center gap-sm rounded-lg border border-hairline bg-card px-md py-xs"
              >
                {/* The row body OPENS THE CARD. Monogram first (start side),
                    then identity. */}
                <button
                  type="button"
                  aria-label={t("candidates.openCard")}
                  onClick={() => {
                    setConfirmId(null);
                    setViewingId(candidate.id);
                  }}
                  disabled={rowDeleting}
                  className="flex min-w-0 flex-1 items-center gap-sm text-start interactive motion-safe:active:scale-[0.99]"
                >
                  {/* Monogram avatar — the SAME recipe as the candidate card
                      (initialsOf), row-scaled. A future profile photo replaces
                      the initials with an <img> inside this same wrapper
                      (overflow-hidden is already in place for it). */}
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-app-blue/10 type-label text-app-blue"
                  >
                    {initialsOf(candidate.name)}
                  </span>

                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex w-full min-w-0 items-center gap-2xs">
                      <span className="truncate type-label font-semibold text-ink">
                        {candidate.name}
                      </span>
                      {candidate.role !== "" ? (
                        <span className="shrink-0 type-label text-muted">
                          · {candidate.role}
                        </span>
                      ) : null}
                      {/* Explicit status marks — stated either way, never
                          hidden-when-false; quiet enough not to fight the name. */}
                      <span
                        className={`inline-flex shrink-0 items-center gap-2xs type-caption ${
                          candidate.hasCertificate ? "text-success" : "text-muted"
                        }`}
                      >
                        {t("candidates.hasCertificate")}
                        {candidate.hasCertificate ? (
                          <CheckIcon width={12} height={12} />
                        ) : (
                          <CloseIcon width={12} height={12} />
                        )}
                        <span className="sr-only">
                          {t(candidate.hasCertificate ? "candidates.yes" : "candidates.no")}
                        </span>
                      </span>
                      <span
                        className={`inline-flex shrink-0 items-center gap-2xs type-caption ${
                          candidate.hasCar ? "text-success" : "text-muted"
                        }`}
                      >
                        {t("candidates.hasCar")}
                        {candidate.hasCar ? (
                          <CheckIcon width={12} height={12} />
                        ) : (
                          <CloseIcon width={12} height={12} />
                        )}
                        <span className="sr-only">
                          {t(candidate.hasCar ? "candidates.yes" : "candidates.no")}
                        </span>
                      </span>
                    </span>
                    {contactLine !== "" ? (
                      <span className="w-full truncate type-caption text-muted">
                        {contactLine}
                      </span>
                    ) : null}
                    {summaryLine !== "" ? (
                      <span className="w-full truncate type-caption text-muted opacity-60">
                        {summaryLine}
                      </span>
                    ) : null}
                  </span>
                </button>

                {/* Delete — a two-tap inline confirm (no modal, no window.confirm):
                    first tap arms "Delete?", a second tap commits. Tapping another
                    row's trash moves the confirm there. */}
                {confirming ? (
                  <button
                    type="button"
                    aria-label={t("candidates.confirmDelete")}
                    onClick={() => {
                      setConfirmId(null);
                      void removeCandidate(candidate.id);
                    }}
                    disabled={rowDeleting}
                    className="shrink-0 rounded-pill bg-danger px-sm py-2xs type-caption text-on-fill interactive motion-safe:active:scale-[0.97]"
                  >
                    {t("candidates.confirmDelete")}
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={t("candidates.delete")}
                    onClick={() => setConfirmId(candidate.id)}
                    disabled={rowDeleting}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted interactive hover:bg-hairline active:bg-hairline motion-safe:active:scale-[0.97]"
                  >
                    <CloseIcon width={16} height={16} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* ARCHIVE DRAWER — a screen-level footer, NOT a stage tab: it appears
          once at the bottom whichever tab is active, because archived rows have
          no tab. The toggle is deliberately the QUIETEST interactive element on
          the screen — a slim centered caption strip under a hairline rule, no
          card, no box. */}
      {!loading && !loadError ? (
        <div className="mt-lg flex flex-col gap-sm">
          <div className="border-t border-hairline pt-2xs">
            <button
              type="button"
              onClick={() => setArchiveOpen((v) => !v)}
              disabled={archived.length === 0}
              aria-expanded={archiveOpen}
              className="flex h-8 w-full items-center justify-center gap-2xs type-caption text-muted interactive disabled:opacity-50 motion-safe:active:scale-[0.99]"
            >
              {/* Points down closed, up open. */}
              <ChevronDownIcon
                width={14}
                height={14}
                className={`motion-safe:transition-transform ${archiveOpen ? "rotate-180" : ""}`}
              />
              <span>{t("candidates.stageArchived")}</span>
              <span>({archived.length})</span>
            </button>
          </div>

          {archiveOpen ? (
            <ul className="flex flex-col gap-sm">
              {archived.map((candidate) => {
                const contactLine = [candidate.phone, candidate.city]
                  .filter((part) => part !== "")
                  .join(" · ");
                const summaryLine = candidate.summary.split("\n")[0] ?? "";
                return (
                  // Same THIN row shape as a live row, visually RECESSED:
                  // reduced opacity, no star, no delete. The body still opens
                  // the candidate card (restore lands there later).
                  <li
                    key={candidate.id}
                    className="flex items-center gap-sm rounded-lg border border-hairline bg-card px-md py-xs opacity-60"
                  >
                    <button
                      type="button"
                      aria-label={t("candidates.openCard")}
                      onClick={() => {
                        setConfirmId(null);
                        setViewingId(candidate.id);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-sm text-start interactive motion-safe:active:scale-[0.99]"
                    >
                      {/* Same monogram recipe as the live rows / candidate card. */}
                      <span
                        aria-hidden="true"
                        className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-app-blue/10 type-label text-app-blue"
                      >
                        {initialsOf(candidate.name)}
                      </span>

                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex w-full min-w-0 items-center gap-2xs">
                          <span className="truncate type-label font-semibold text-ink">
                            {candidate.name}
                          </span>
                          {candidate.role !== "" ? (
                            <span className="shrink-0 type-label text-muted">
                              · {candidate.role}
                            </span>
                          ) : null}
                          <span
                            className={`inline-flex shrink-0 items-center gap-2xs type-caption ${
                              candidate.hasCertificate ? "text-success" : "text-muted"
                            }`}
                          >
                            {t("candidates.hasCertificate")}
                            {candidate.hasCertificate ? (
                              <CheckIcon width={12} height={12} />
                            ) : (
                              <CloseIcon width={12} height={12} />
                            )}
                            <span className="sr-only">
                              {t(candidate.hasCertificate ? "candidates.yes" : "candidates.no")}
                            </span>
                          </span>
                          <span
                            className={`inline-flex shrink-0 items-center gap-2xs type-caption ${
                              candidate.hasCar ? "text-success" : "text-muted"
                            }`}
                          >
                            {t("candidates.hasCar")}
                            {candidate.hasCar ? (
                              <CheckIcon width={12} height={12} />
                            ) : (
                              <CloseIcon width={12} height={12} />
                            )}
                            <span className="sr-only">
                              {t(candidate.hasCar ? "candidates.yes" : "candidates.no")}
                            </span>
                          </span>
                        </span>
                        {contactLine !== "" ? (
                          <span className="w-full truncate type-caption text-muted">
                            {contactLine}
                          </span>
                        ) : null}
                        {summaryLine !== "" ? (
                          <span className="w-full truncate type-caption text-muted opacity-60">
                            {summaryLine}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * The form overlay — scrim + sheet (bottom on phones, centered on wider), closed
 * by scrim tap and Escape. Follows the shell's dialog recipe (UrgencyInbox):
 * `bg-scrim` backdrop, `ds-backdrop`/`ds-panel`, `shadow-lifted` sheet. GENERIC
 * over its children ON PURPOSE (Standard: one overlay, many modes) — it hosts
 * the add form AND the candidate card. An optional `header` REPLACES the
 * default title-and-X row (the candidate card supplies its stage/archive
 * header this way); when absent the add form's title row renders unchanged.
 * `title` always names the dialog for assistive tech, header or not.
 */
function CandidateFormOverlay({
  title,
  onClose,
  header,
  children,
}: {
  title: string;
  onClose: () => void;
  header?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* The scrim IS the close control — a full-bleed button, so a tap anywhere
          outside the sheet dismisses (and it's reachable by assistive tech). */}
      <button
        type="button"
        aria-label={t("candidates.cancel")}
        onClick={onClose}
        className="ds-backdrop absolute inset-0 bg-scrim"
      />

      <div className="ds-panel relative z-10 w-full max-w-[480px] px-sm pb-sm">
        <div className="flex max-h-[85dvh] flex-col gap-sm overflow-y-auto rounded-lg bg-screen p-md shadow-lifted">
          {header ?? (
            <div className="flex items-center justify-between">
              <h2 className="type-heading text-ink">{title}</h2>
              <button
                type="button"
                aria-label={t("candidates.cancel")}
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-card text-muted interactive motion-safe:active:scale-[0.97]"
              >
                <CloseIcon width={18} height={18} />
              </button>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

function AddCandidateForm({
  onCreated,
  onError,
}: {
  onCreated: (candidate: Candidate) => void;
  onError: (code: WriteErrorCode) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [email, setEmail] = useState("");
  const [availability, setAvailability] = useState("");
  const [salaryExpectation, setSalaryExpectation] = useState("");
  const [summary, setSummary] = useState("");
  const [impression, setImpression] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [hasCertificate, setHasCertificate] = useState(false);
  const [hasCar, setHasCar] = useState(false);
  // Whether the required name is blank-on-submit. Drives the marking + message;
  // cleared as soon as the user edits it.
  const [invalid, setInvalid] = useState<{ name: boolean }>({ name: false });
  // True while an add is in flight. Disables the submit button and makes a second
  // submit a no-op, so a double-tap can't write a duplicate row.
  const [submitting, setSubmitting] = useState(false);

  // Guard: onCreated/onError setState in the PARENT after the await. If we unmount
  // mid-submit (e.g. the overlay is dismissed), this stops us from touching the
  // parent's state.
  const mounted = useRef(true);
  useEffect(() => {
    // Re-arm on every (re)mount (StrictMode runs mount → cleanup → mount) so the
    // guard isn't left permanently disarmed.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // A second submit while one is already in flight is a no-op (belt-and-suspenders
    // with the disabled button — this also covers Enter-key resubmits).
    if (submitting) return;

    const nextName = name.trim();

    // Required-field validation is VISIBLE now — a blank name marks itself and
    // says what is missing, instead of the submit silently doing nothing.
    const nextInvalid = { name: nextName === "" };
    setInvalid(nextInvalid);
    if (nextInvalid.name) return;

    // The rest are optional; empties are a real "unset" (stored as '' / {}).
    const nextRole = role.trim();
    const nextPhone = phone.trim();
    const nextCity = city.trim();
    const nextEmail = email.trim();
    const nextAvailability = availability.trim();
    const nextSalary = salaryExpectation.trim();
    const nextSummary = summary.trim();
    const nextImpression = impression.trim();
    const nextTags = parseTags(tagsRaw);

    // Lock only AFTER validation passes, so a failed validation leaves the button
    // usable. Released in `finally`, whatever the outcome.
    setSubmitting(true);
    try {
      // No ctx argument — the server builds it from the session. stage is NOT
      // sent: the DB defaults it to 'contact'. Empty strings are sent as
      // undefined (the DB default '' is the same value); booleans go as-is.
      const res = await runIntentAction("candidates.create_candidate", {
        name: nextName,
        role: nextRole === "" ? undefined : nextRole,
        summary: nextSummary === "" ? undefined : nextSummary,
        tags: nextTags.length === 0 ? undefined : nextTags,
        phone: nextPhone === "" ? undefined : nextPhone,
        city: nextCity === "" ? undefined : nextCity,
        email: nextEmail === "" ? undefined : nextEmail,
        impression: nextImpression === "" ? undefined : nextImpression,
        availability: nextAvailability === "" ? undefined : nextAvailability,
        salaryExpectation: nextSalary === "" ? undefined : nextSalary,
        hasCertificate,
        hasCar,
      });
      if (!mounted.current) return;

      if (res.ok) {
        // create_candidate returns only { id }; the rest of the Candidate is the
        // values we just submitted plus the DB defaults, so we can hand a complete
        // row up to append.
        const { id } = res.data as { id: string };
        onCreated({
          id,
          name: nextName,
          role: nextRole,
          stage: "contact",
          summary: nextSummary,
          tags: nextTags,
          urgent: false,
          rejectReason: "",
          hasCertificate,
          phone: nextPhone,
          city: nextCity,
          email: nextEmail,
          impression: nextImpression,
          availability: nextAvailability,
          hasCar,
          salaryExpectation: nextSalary,
        });
      } else {
        onError(res.code);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  // One recipe per text field keeps the form scannable (delegates to the
  // SHARED TextField — the same recipe the card's edit mode uses).
  const textField = (
    label: string,
    value: string,
    setValue: (v: string) => void,
    placeholder: string,
  ) => <TextField label={label} value={value} placeholder={placeholder} onChange={setValue} />;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-sm rounded-lg bg-card p-md">
      <label className="flex flex-col gap-2xs type-label text-muted">
        <span>
          {t("candidates.candidateName")}{" "}
          <span aria-hidden="true" className="text-danger">
            *
          </span>
        </span>
        <input
          className={invalid.name ? `${inputClass} ${invalidRing}` : inputClass}
          value={name}
          placeholder={t("candidates.namePlaceholder")}
          onChange={(e) => {
            setName(e.target.value);
            if (invalid.name) setInvalid((v) => ({ ...v, name: false }));
          }}
          aria-required="true"
          aria-invalid={invalid.name}
        />
        {invalid.name ? (
          <span role="alert" className="type-caption text-danger">
            {t("candidates.fieldRequired")}
          </span>
        ) : null}
      </label>
      {textField(t("candidates.roleLabel"), role, setRole, t("candidates.rolePlaceholder"))}
      {textField(t("candidates.phoneLabel"), phone, setPhone, t("candidates.phonePlaceholder"))}
      {textField(t("candidates.cityLabel"), city, setCity, t("candidates.cityPlaceholder"))}
      {textField(t("candidates.emailLabel"), email, setEmail, t("candidates.emailPlaceholder"))}
      {textField(
        t("candidates.availabilityLabel"),
        availability,
        setAvailability,
        t("candidates.availabilityPlaceholder"),
      )}
      {textField(
        t("candidates.salaryLabel"),
        salaryExpectation,
        setSalaryExpectation,
        t("candidates.salaryPlaceholder"),
      )}
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("candidates.summaryLabel")}
        <textarea
          className={`${inputClass} min-h-24 resize-y`}
          value={summary}
          placeholder={t("candidates.summaryPlaceholder")}
          rows={3}
          onChange={(e) => setSummary(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("candidates.impressionLabel")}
        <textarea
          className={`${inputClass} min-h-24 resize-y`}
          value={impression}
          placeholder={t("candidates.impressionPlaceholder")}
          rows={3}
          onChange={(e) => setImpression(e.target.value)}
        />
      </label>
      {textField(t("candidates.tagsLabel"), tagsRaw, setTagsRaw, t("candidates.tagsPlaceholder"))}
      <div className="flex items-center gap-md">
        <label className="flex items-center gap-xs type-label text-muted">
          <input
            type="checkbox"
            checked={hasCertificate}
            onChange={(e) => setHasCertificate(e.target.checked)}
            className="h-4 w-4"
          />
          {t("candidates.hasCertificate")}
        </label>
        <label className="flex items-center gap-xs type-label text-muted">
          <input
            type="checkbox"
            checked={hasCar}
            onChange={(e) => setHasCar(e.target.checked)}
            className="h-4 w-4"
          />
          {t("candidates.hasCar")}
        </label>
      </div>
      <button type="submit" disabled={submitting} className={primaryButtonClass}>
        {t("candidates.add")}
      </button>
    </form>
  );
}
