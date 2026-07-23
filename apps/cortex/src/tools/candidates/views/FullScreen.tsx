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
 * ROWS are compact: name · role · certificate check · phone · city · first
 * summary line. Tapping a row opens the CANDIDATE CARD — a READ-ONLY overlay
 * (view mode; edit mode mounts in the same shell later) reusing
 * `CandidateFormOverlay`. The card's footer reuses the EXISTING set_stage flow
 * (`moveStage` + its per-id guard) for Archive / Advance — no duplicated write
 * logic. The old inline row-editor was REMOVED with the row tap reassigned to
 * the card; editing returns as the card's edit mode (`candidates.update_candidate`
 * stays live — the urgent star uses it today).
 *
 * TONE: quiet. The accent is used sparingly — subtle `bg-app-blue/10` +
 * `text-app-blue` tints for the active tab, primary submits and the certificate
 * mark; every other surface sits on the neutral roles (bg-card / text-ink /
 * text-muted / hairline). No solid accent fills.
 *
 * WRITES (unchanged): the read is the SHARED react-query cache
 * (`useCandidatesList`, queryKey ["candidates","list"]) — the same entry the
 * dashboard card reads — and each write reconciles that cache via setQueryData
 * (no refetch), OPTIMISTICALLY with snapshot-revert on failure. Writes flow
 * runIntentAction -> the server data-layer -> the RLS client, gated ROW BY ROW
 * by `private.auth_user_can_write`; failures surface honestly, never faked and
 * never swallowed. Per-id in-flight guards: star / stage / delete each hold
 * their own lock.
 *
 * Built from design-system utilities + i18n only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { runIntentAction, type IntentResult } from "@/cortex/actions";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { CheckIcon, ChevronIcon, CloseIcon, InfoIcon, PlusIcon, StarIcon } from "@/components/icons";
import type { Candidate, CandidateStage } from "../logic";
import { useCandidatesList, CANDIDATES_LIST_KEY } from "@/lib/query/useCandidatesList";

/** The failure codes a write can come back with (from {@link IntentResult}). */
type WriteErrorCode = Extract<IntentResult, { ok: false }>["code"];

/** The stages this view shows, in tab order. `archived` is DELIBERATELY absent:
 * it exists in the DB and intents (rows keep archiving), it just has no tab. */
const VISIBLE_STAGES = ["contact", "interview", "intake"] as const;
type VisibleStage = (typeof VISIBLE_STAGES)[number];

/** Stage → its i18n label key (tabs and stage buttons). */
const STAGE_LABEL_KEY = {
  contact: "candidates.stageContact",
  interview: "candidates.stageInterview",
  intake: "candidates.stageIntake",
  archived: "candidates.stageArchived",
} as const;

/** The "advance" transition per stage. `intake` has no forward stage — its only
 * exit is the archive control; `archived` is terminal. */
const NEXT_STAGE: Partial<Record<CandidateStage, CandidateStage>> = {
  contact: "interview",
  interview: "intake",
};

/** Parse the comma-separated tags input into a clean string[] — trimmed, empties
 * dropped. */
function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
}

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
  // each render, so a star toggle from the card is reflected immediately.
  const [viewingId, setViewingId] = useState<string | null>(null);
  // Which row has the inline archive form open (null = none).
  const [archivingId, setArchivingId] = useState<string | null>(null);
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

  // In-flight STAR toggles and STAGE moves — SEPARATE per-id guards, same shape,
  // so a star and a stage move never share a lock.
  const starringRef = useRef<Set<string>>(new Set());
  const stagingRef = useRef<Set<string>>(new Set());

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

  const toggleUrgent = useCallback(
    async (id: string, nextUrgent: boolean) => {
      // 0. GUARD: one star write per row at a time (its own lock — see above).
      if (starringRef.current.has(id)) return;

      const prevList = queryClient.getQueryData<Candidate[]>(CANDIDATES_LIST_KEY) ?? [];
      const prev = prevList.find((it) => it.id === id) ?? null;

      starringRef.current = new Set(starringRef.current).add(id);

      // 1. OPTIMISTIC flip, shared cache first.
      setWriteError(null);
      patchCandidate(id, (it) => ({ ...it, urgent: nextUrgent }));

      try {
        const res = await runIntentAction("candidates.update_candidate", {
          id,
          urgent: nextUrgent,
        });
        if (!res.ok) {
          // REVERT + surface.
          if (prev) patchCandidate(id, () => prev);
          if (mounted.current) setWriteError(res.code);
        }
      } finally {
        const cleared = new Set(starringRef.current);
        cleared.delete(id);
        starringRef.current = cleared;
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
        if (res.ok) {
          // 2. Success: close the archive form if it was this row's.
          if (mounted.current) setArchivingId((cur) => (cur === id ? null : cur));
        } else {
          // 3. REVERT + surface; leave the archive form open so the reason isn't lost.
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
  // The card's candidate, resolved from the LIVE cache (not a snapshot) so
  // writes made from the card render immediately.
  const viewing = viewingId ? (candidates.find((it) => it.id === viewingId) ?? null) : null;

  return (
    <>
      {/* TOP BAR — one row, one family of five: back (start = right in RTL) ·
          three stage tabs · add (end). The two end CIRCLES are the prominent
          pair (bg-card + hairline border + lifted shadow); the tabs are quiet
          rounded RECTANGLES at the same h-10, so all five share one line. On
          narrow screens the tab GROUP scrolls sideways (w-max inside an
          overflow-x wrapper — mx-auto centers it while it fits); the circles
          stay pinned at the ends. */}
      <div className="flex items-center gap-xs">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label={t("candidates.back")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-hairline bg-card text-ink shadow-lifted interactive motion-safe:active:scale-[0.97]"
        >
          {/* Points RIGHT in RTL (the flip), LEFT in LTR — always "back". */}
          <ChevronIcon style={{ transform: dir === "rtl" ? "scaleX(-1)" : undefined }} />
        </button>

        <div className="min-w-0 flex-1 overflow-x-auto">
          <div
            role="tablist"
            aria-label={t("candidates.name")}
            className="mx-auto flex w-max items-center gap-2xs"
          >
            {VISIBLE_STAGES.map((stage, i) => {
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
                  className={`flex h-10 shrink-0 items-center gap-2xs rounded-lg border px-sm type-label interactive motion-safe:active:scale-[0.97] ${
                    active
                      ? "border-app-blue/30 bg-app-blue/10 text-app-blue"
                      : "border-hairline bg-card text-muted"
                  }`}
                >
                  {/* One centerline for all three: the row is items-center, and
                      the number sits INSIDE a fixed circle instead of on its own
                      text baseline. */}
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full type-caption ${
                      active ? "bg-app-blue/20" : "bg-hairline"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span>{t(STAGE_LABEL_KEY[stage])}</span>
                  <span className="type-caption text-muted">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setAdding(true)}
          aria-label={t("candidates.addCandidate")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-hairline bg-card text-ink shadow-lifted interactive motion-safe:active:scale-[0.97]"
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

      {/* THE CANDIDATE CARD — read-only view mode in the SAME overlay shell the
          add form uses. Stage actions reuse the existing moveStage handler (and
          its per-id guard); the card closes optimistically with the write — on
          failure the row reverts and the screen-level alert reports it. */}
      {viewing ? (
        <CandidateFormOverlay title={t("candidates.cardTitle")} onClose={() => setViewingId(null)}>
          <CandidateCard
            candidate={viewing}
            nextStage={NEXT_STAGE[viewing.stage]}
            onToggleUrgent={() => void toggleUrgent(viewing.id, !viewing.urgent)}
            onAdvance={(next) => {
              void moveStage(viewing.id, next);
              setViewingId(null);
            }}
            onArchive={(reason) => {
              const write = moveStage(viewing.id, "archived", reason);
              setViewingId(null);
              return write;
            }}
          />
        </CandidateFormOverlay>
      ) : null}

      {loading ? (
        // Skeleton on the very first load only (cache empty); arriving from the
        // card the cache is warm and this never shows.
        <ul className="flex flex-col divide-y divide-hairline" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="flex items-center justify-between py-sm">
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
        <ul className="flex flex-col divide-y divide-hairline">
          {items.map((candidate) => {
            const rowDeleting = deleting.has(candidate.id);
            const confirming = confirmId === candidate.id;
            const nextStage = NEXT_STAGE[candidate.stage];
            // The compact contact line: phone · city (only the present parts).
            const contactLine = [candidate.phone, candidate.city]
              .filter((part) => part !== "")
              .join(" · ");
            // First line of the summary only — the row is compact; the card has
            // the rest. (No stage number here: the row only ever renders inside
            // its own stage tab, so it would be redundant.)
            const summaryLine = candidate.summary.split("\n")[0] ?? "";

            return (
              <li key={candidate.id} className="flex flex-col gap-xs py-sm">
                <div className="flex items-center gap-sm">
                  {/* Urgent star — an optimistic one-field toggle. */}
                  <button
                    type="button"
                    aria-label={t("candidates.urgent")}
                    aria-pressed={candidate.urgent}
                    onClick={() => void toggleUrgent(candidate.id, !candidate.urgent)}
                    disabled={rowDeleting}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full interactive motion-safe:active:scale-[0.97] ${
                      candidate.urgent
                        ? "bg-app-amber/15 text-app-amber"
                        : "bg-hairline text-muted"
                    }`}
                  >
                    <StarIcon width={16} height={16} />
                  </button>

                  {/* The row body OPENS THE CARD (read-only view). */}
                  <button
                    type="button"
                    aria-label={t("candidates.openCard")}
                    onClick={() => {
                      setConfirmId(null);
                      setArchivingId(null);
                      setViewingId(candidate.id);
                    }}
                    disabled={rowDeleting}
                    className="flex min-w-0 flex-1 flex-col items-start gap-2xs text-start interactive motion-safe:active:scale-[0.99]"
                  >
                    <span className="flex w-full min-w-0 items-center gap-2xs">
                      <span className="truncate type-heading text-ink">{candidate.name}</span>
                      {candidate.role ? (
                        <span className="shrink-0 type-label text-muted">
                          · {candidate.role}
                        </span>
                      ) : null}
                      {candidate.hasCertificate ? (
                        <span
                          aria-label={t("candidates.hasCertificate")}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-app-blue/10 text-app-blue"
                        >
                          <CheckIcon width={12} height={12} />
                        </span>
                      ) : null}
                    </span>
                    {contactLine !== "" ? (
                      <span className="w-full truncate type-label text-muted">{contactLine}</span>
                    ) : null}
                    {summaryLine !== "" ? (
                      <span className="w-full truncate type-caption text-muted">
                        {summaryLine}
                      </span>
                    ) : null}
                  </button>

                  {/* Stage control: advance to the next stage (when one exists)
                      and archive — both on neutral surfaces; the accent belongs
                      to the active tab, not to every action. */}
                  {nextStage ? (
                    <button
                      type="button"
                      aria-label={t("candidates.advance")}
                      onClick={() => void moveStage(candidate.id, nextStage)}
                      disabled={rowDeleting}
                      className="shrink-0 rounded-pill bg-hairline px-sm py-2xs type-caption text-ink interactive motion-safe:active:scale-[0.97]"
                    >
                      {t(STAGE_LABEL_KEY[nextStage])}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label={t("candidates.archive")}
                    onClick={() => {
                      setConfirmId(null);
                      setArchivingId((cur) => (cur === candidate.id ? null : candidate.id));
                    }}
                    disabled={rowDeleting}
                    className="shrink-0 rounded-pill bg-hairline px-sm py-2xs type-caption text-muted interactive motion-safe:active:scale-[0.97]"
                  >
                    {t("candidates.archive")}
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
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-hairline text-muted interactive motion-safe:active:scale-[0.97]"
                    >
                      <CloseIcon width={16} height={16} />
                    </button>
                  )}
                </div>

                {/* Inline archive form: optional reason, then commit. */}
                {archivingId === candidate.id ? (
                  <ArchiveForm
                    onArchive={(reason) => moveStage(candidate.id, "archived", reason)}
                    onCancel={() => setArchivingId(null)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

const inputClass =
  "w-full rounded-md bg-screen px-sm py-sm type-body text-ink outline-none placeholder:text-muted";
const invalidRing = "ring-1 ring-danger";
/** The quiet primary action — a subtle accent tint, never a solid fill. */
const primaryButtonClass =
  "rounded-md bg-app-blue/10 py-sm type-label text-app-blue interactive motion-safe:active:scale-[0.97]";

/**
 * The form overlay — scrim + sheet (bottom on phones, centered on wider), closed
 * by scrim tap and Escape. Follows the shell's dialog recipe (UrgencyInbox):
 * `bg-scrim` backdrop, `ds-backdrop`/`ds-panel`, `shadow-lifted` sheet. GENERIC
 * over its children ON PURPOSE (Standard: one overlay, many modes) — it hosts
 * the add form AND the candidate card today, edit mode next.
 */
function CandidateFormOverlay({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
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
          {children}
        </div>
      </div>
    </div>
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

/**
 * The candidate card — READ-ONLY view mode. No inputs; edit mode is a later
 * step (see the slot in the header). Stage actions delegate to the parent's
 * moveStage (the ONE set_stage flow with its per-id guard) — never their own
 * writes.
 */
function CandidateCard({
  candidate,
  nextStage,
  onToggleUrgent,
  onAdvance,
  onArchive,
}: {
  candidate: Candidate;
  nextStage: CandidateStage | undefined;
  onToggleUrgent: () => void;
  onAdvance: (next: CandidateStage) => void;
  onArchive: (reason?: string) => Promise<void>;
}) {
  const { t } = useI18n();
  // Whether the archive-reason form is open above the footer.
  const [showArchive, setShowArchive] = useState(false);

  return (
    <div className="flex flex-col gap-sm">
      {/* Header: name · role · urgent star · certificate check. */}
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

        {/* The star stays LIVE in view mode — it's the same optimistic one-field
            toggle the row has, on the same per-id guard. */}
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
            neutral when not). */}
        <span
          aria-label={t("candidates.hasCertificate")}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            candidate.hasCertificate ? "bg-app-blue/10 text-app-blue" : "bg-hairline text-muted"
          }`}
        >
          <CheckIcon width={16} height={16} />
        </span>

        {/* EDIT-TOGGLE SLOT — the edit-mode toggle (next prompt) mounts HERE, as
            one more h-9 w-9 circle in this header row. Do not fill it early. */}
      </div>

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
          <CardField label={t("candidates.availabilityLabel")} value={candidate.availability} />
          <CardField
            label={t("candidates.hasCar")}
            value={t(candidate.hasCar ? "candidates.yes" : "candidates.no")}
          />
          <CardField label={t("candidates.salaryLabel")} value={candidate.salaryExpectation} />
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
          actions through the EXISTING flow + the documents placeholder. */}
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

  // One recipe per text field keeps the form scannable.
  const textField = (
    label: string,
    value: string,
    setValue: (v: string) => void,
    placeholder: string,
  ) => (
    <label className="flex flex-col gap-2xs type-label text-muted">
      {label}
      <input
        className={inputClass}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
      />
    </label>
  );

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

/** Inline archive form — an OPTIONAL reason then commit. The parent's moveStage
 * owns the write (and its per-id guard), so this stays a dumb controlled input;
 * `disabled` while the tap settles is covered by that guard, not local state. */
function ArchiveForm({
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
