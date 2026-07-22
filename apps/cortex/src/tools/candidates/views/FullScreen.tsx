"use client";

/**
 * Candidates full screen (Standard §2 `views/FullScreen.tsx`, §8). Cloned from
 * Notes' full screen, on the app-blue identity accent.
 *
 * Candidate pipeline grouped BY STAGE (contact → interview → intake → archived),
 * with an add action, a per-row inline EDIT (name/role/summary/tags/urgent), a
 * star toggle for `urgent`, a stage control (advance to the next stage + archive
 * with an optional reject reason), and a two-tap per-row delete. The read is the
 * SHARED react-query cache (`useCandidatesList`, queryKey ["candidates","list"])
 * — the same entry the dashboard card reads — so this screen renders from cache
 * and each write reconciles that cache via setQueryData (no refetch). Writes go
 * straight through the SERVER action (`runIntentAction`); every call — read or
 * write — builds ctx from the session, so no identity is sent from here.
 *
 * WRITES WORK (20260722000001 opened the path, mirroring notes). A write flows
 * runIntentAction -> the server data-layer -> the RLS client, gated ROW BY ROW by
 * `private.auth_user_can_write`: membership in the row's org tree is the gate. A
 * write can genuinely succeed — so this screen edits/deletes OPTIMISTICALLY and
 * reconciles to the server's authoritative answer — or genuinely fail, in which
 * case the failure is surfaced honestly, never faked and never swallowed.
 *
 * THE SHAPE DIFFERENCES FROM NOTES: rows are grouped into stage sections, and on
 * top of the generic edit there are two one-field writes — the urgent star
 * (`candidates.update_candidate`) and the stage control (`candidates.set_stage`)
 * — each with its own per-id in-flight guard, same discipline as notes' edit/delete.
 *
 * Built from design-system utilities + i18n only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { runIntentAction, type IntentResult } from "@/cortex/actions";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { ChevronIcon, CloseIcon, InfoIcon, SparkIcon } from "@/components/icons";
import { CANDIDATE_STAGES, type Candidate, type CandidateStage } from "../logic";
import { useCandidatesList, CANDIDATES_LIST_KEY } from "@/lib/query/useCandidatesList";

/** The failure codes a write can come back with (from {@link IntentResult}). */
type WriteErrorCode = Extract<IntentResult, { ok: false }>["code"];

/** Stage → its i18n label key (the section headers and stage buttons). */
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
 * dropped. The inverse of the `join(", ")` the edit form seeds with. */
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
  const [adding, setAdding] = useState(false);
  // Which candidate is being edited inline (null = none). One row edits at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
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

  // In-flight EDITS, keyed by candidate id. A second save for a row whose write is
  // still running is ignored, so a double-tap can't double-apply. PER-ROW, not a
  // global lock. The ref is the synchronous source of truth for the guard.
  const savingRef = useRef<Set<string>>(new Set());

  // In-flight STAR toggles and STAGE moves — SEPARATE per-id guards, same shape,
  // so an edit, a star and a stage move never share a lock.
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

  const saveCandidate = useCallback(
    async (
      id: string,
      next: { name: string; role: string; summary: string; tags: string[]; urgent: boolean },
    ) => {
      // 0. GUARD double-submit: ignore a save for a row whose write is still in
      //    flight. The ref check is synchronous, so it catches a second tap in the
      //    micro-window before the disabled button re-renders.
      if (savingRef.current.has(id)) return;

      // Snapshot the row BEFORE editing, so a failure can restore it exactly.
      const prevList = queryClient.getQueryData<Candidate[]>(CANDIDATES_LIST_KEY) ?? [];
      const prev = prevList.find((it) => it.id === id) ?? null;

      savingRef.current = new Set(savingRef.current).add(id);

      // 1. OPTIMISTIC: write the new fields straight into the SHARED cache,
      //    before awaiting, so the edit has instant feedback AND the dashboard card
      //    (reading the same cache) moves in lockstep.
      setWriteError(null);
      patchCandidate(id, (it) => ({ ...it, ...next }));

      try {
        const res = await runIntentAction("candidates.update_candidate", { id, ...next });

        if (res.ok) {
          // 2. Success: close the inline editor. Nothing to reconcile — the cache
          //    already holds exactly what we submitted, which is authoritative.
          if (mounted.current) setEditingId((cur) => (cur === id ? null : cur));
        } else {
          // 3. REVERT to the snapshot and surface the real error; leave the editor
          //    open so the edit isn't lost. The cache is written only on these
          //    chosen paths, so a failure leaves it consistent — never corrupted.
          if (prev) patchCandidate(id, () => prev);
          if (mounted.current) setWriteError(res.code);
        }
      } finally {
        // Clear the in-flight mark whether the write succeeded, failed, or threw.
        const cleared = new Set(savingRef.current);
        cleared.delete(id);
        savingRef.current = cleared;
      }
    },
    [patchCandidate, queryClient],
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
          // REVERT + surface, exactly like saveCandidate.
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

      // 1. OPTIMISTIC: move the row to its new section immediately. Mirrors the
      //    server's setStage: archiving writes rejectReason (defaulting to ''),
      //    any other move leaves the stored reason untouched.
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
      // 0. GUARD double-delete (mirrors saveCandidate's in-flight guard): ignore a
      //    delete for a row whose delete is already running.
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

  // Stage sections in pipeline order; empty stages render nothing (the section
  // headers exist for the rows, not as a fixed board).
  const sections = CANDIDATE_STAGES.map((stage) => ({
    stage,
    items: candidates.filter((it) => it.stage === stage),
  })).filter((section) => section.items.length > 0);

  return (
    <>
      <div className="flex items-center gap-xs">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label={t("common.back")}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink interactive motion-safe:active:scale-[0.97]"
        >
          <ChevronIcon style={{ transform: dir === "rtl" ? "scaleX(-1)" : undefined }} />
        </button>
        <h1 className="flex-1 type-title text-ink">{t("candidates.name")}</h1>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-pill bg-app-blue px-md py-xs type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
        >
          {t("candidates.addCandidate")}
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
          }}
          onError={(code) => setWriteError(code)}
        />
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
      ) : candidates.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-xs rounded-lg bg-card px-lg py-2xl text-center">
          <p className="type-heading text-ink">{t("candidates.emptyTitle")}</p>
          <p className="max-w-[24ch] type-label text-muted">{t("candidates.emptyHint")}</p>
        </div>
      ) : (
        sections.map(({ stage, items }) => (
          <section key={stage} className="flex flex-col gap-2xs">
            <h2 className="flex items-center gap-xs type-label text-muted">
              <span>{t(STAGE_LABEL_KEY[stage])}</span>
              <span className="rounded-pill bg-hairline px-xs type-caption text-muted">
                {items.length}
              </span>
            </h2>
            <ul className="flex flex-col divide-y divide-hairline">
              {items.map((candidate) => {
                const rowDeleting = deleting.has(candidate.id);
                const confirming = confirmId === candidate.id;
                const nextStage = NEXT_STAGE[candidate.stage];

                // Editing: the whole row becomes an inline edit form.
                if (editingId === candidate.id) {
                  return (
                    <li key={candidate.id} className="py-sm">
                      <EditCandidateForm
                        candidate={candidate}
                        onSave={(next) => saveCandidate(candidate.id, next)}
                        onCancel={() => setEditingId(null)}
                      />
                    </li>
                  );
                }

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
                        <SparkIcon width={16} height={16} />
                      </button>

                      <button
                        type="button"
                        aria-label={t("candidates.editCandidate")}
                        onClick={() => {
                          setConfirmId(null);
                          setArchivingId(null);
                          setEditingId(candidate.id);
                        }}
                        disabled={rowDeleting}
                        className="flex min-w-0 flex-1 flex-col items-start gap-2xs text-start interactive motion-safe:active:scale-[0.99]"
                      >
                        <span className="w-full truncate type-heading text-ink">
                          {candidate.name}
                          {candidate.role ? (
                            <span className="type-label text-muted"> · {candidate.role}</span>
                          ) : null}
                        </span>
                        {candidate.summary ? (
                          <span className="w-full truncate type-label text-muted">
                            {candidate.summary}
                          </span>
                        ) : null}
                        {candidate.tags.length > 0 ? (
                          <span className="w-full truncate type-caption text-muted">
                            {candidate.tags.join(" · ")}
                          </span>
                        ) : null}
                        {candidate.stage === "archived" && candidate.rejectReason ? (
                          <span className="w-full truncate type-caption text-danger">
                            {t("candidates.rejectReason")}: {candidate.rejectReason}
                          </span>
                        ) : null}
                      </button>

                      {/* Stage control: advance to the next stage (when one exists)
                          and archive (when not already archived). */}
                      {nextStage ? (
                        <button
                          type="button"
                          aria-label={t("candidates.advance")}
                          onClick={() => void moveStage(candidate.id, nextStage)}
                          disabled={rowDeleting}
                          className="shrink-0 rounded-pill bg-app-blue/15 px-sm py-2xs type-caption text-app-blue interactive motion-safe:active:scale-[0.97]"
                        >
                          {t(STAGE_LABEL_KEY[nextStage])}
                        </button>
                      ) : null}
                      {candidate.stage !== "archived" ? (
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
                      ) : null}

                      {/* Delete — a two-tap inline confirm (no modal, no
                          window.confirm): first tap arms "Delete?", a second tap
                          commits. Tapping another row's trash moves the confirm there. */}
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
          </section>
        ))
      )}
    </>
  );
}

const inputClass =
  "w-full rounded-md bg-screen px-sm py-sm type-body text-ink outline-none placeholder:text-muted";
const invalidRing = "ring-1 ring-danger";

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
  const [summary, setSummary] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  // Whether the required name is blank-on-submit. Drives the marking + message;
  // cleared as soon as the user edits it.
  const [invalid, setInvalid] = useState<{ name: boolean }>({ name: false });
  // True while an add is in flight. Disables the submit button and makes a second
  // submit a no-op, so a double-tap can't write a duplicate row.
  const [submitting, setSubmitting] = useState(false);

  // Guard: onCreated/onError setState in the PARENT after the await. If we unmount
  // mid-submit, this stops us from touching the parent's state.
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
    const nextSummary = summary.trim();
    const nextTags = parseTags(tagsRaw);

    // Lock only AFTER validation passes, so a failed validation leaves the button
    // usable. Released in `finally`, whatever the outcome.
    setSubmitting(true);
    try {
      // No ctx argument — the server builds it from the session. stage is NOT
      // sent: the DB defaults it to 'contact'.
      const res = await runIntentAction("candidates.create_candidate", {
        name: nextName,
        role: nextRole === "" ? undefined : nextRole,
        summary: nextSummary === "" ? undefined : nextSummary,
        tags: nextTags.length === 0 ? undefined : nextTags,
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
        });
      } else {
        onError(res.code);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

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
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("candidates.roleLabel")}
        <input
          className={inputClass}
          value={role}
          placeholder={t("candidates.rolePlaceholder")}
          onChange={(e) => setRole(e.target.value)}
        />
      </label>
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
        {t("candidates.tagsLabel")}
        <input
          className={inputClass}
          value={tagsRaw}
          placeholder={t("candidates.tagsPlaceholder")}
          onChange={(e) => setTagsRaw(e.target.value)}
        />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-app-blue py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
      >
        {t("candidates.add")}
      </button>
    </form>
  );
}

function EditCandidateForm({
  candidate,
  onSave,
  onCancel,
}: {
  candidate: Candidate;
  onSave: (next: {
    name: string;
    role: string;
    summary: string;
    tags: string[];
    urgent: boolean;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(candidate.name);
  const [role, setRole] = useState(candidate.role);
  const [summary, setSummary] = useState(candidate.summary);
  // Tags edit as the same comma-separated text the add form takes; seeded from
  // the row and parsed back on submit.
  const [tagsRaw, setTagsRaw] = useState(candidate.tags.join(", "));
  const [urgent, setUrgent] = useState(candidate.urgent);
  const [invalid, setInvalid] = useState<{ name: boolean }>({ name: false });
  // True while a save is in flight. Disables submit and makes a second submit a
  // no-op (the parent's saveCandidate also guards per-id — belt-and-suspenders).
  const [submitting, setSubmitting] = useState(false);

  // Guard: setSubmitting resolves after the await; the parent closes this editor
  // on success (unmounting us), so gate the post-await setState.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const nextName = name.trim();
    const nextInvalid = { name: nextName === "" };
    setInvalid(nextInvalid);
    if (nextInvalid.name) return;

    setSubmitting(true);
    try {
      await onSave({
        name: nextName,
        role: role.trim(),
        summary: summary.trim(),
        tags: parseTags(tagsRaw),
        urgent,
      });
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

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
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("candidates.roleLabel")}
        <input
          className={inputClass}
          value={role}
          placeholder={t("candidates.rolePlaceholder")}
          onChange={(e) => setRole(e.target.value)}
        />
      </label>
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
        {t("candidates.tagsLabel")}
        <input
          className={inputClass}
          value={tagsRaw}
          placeholder={t("candidates.tagsPlaceholder")}
          onChange={(e) => setTagsRaw(e.target.value)}
        />
      </label>
      <label className="flex items-center gap-xs type-label text-muted">
        <input
          type="checkbox"
          checked={urgent}
          onChange={(e) => setUrgent(e.target.checked)}
          className="h-4 w-4"
        />
        {t("candidates.urgent")}
      </label>
      <div className="flex items-center gap-sm">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-md bg-app-blue py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
        >
          {t("candidates.save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-md bg-hairline px-md py-sm type-label text-ink interactive motion-safe:active:scale-[0.97]"
        >
          {t("candidates.cancel")}
        </button>
      </div>
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
        <button
          type="submit"
          className="flex-1 rounded-md bg-app-blue py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
        >
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
