"use client";

/**
 * Questionnaire full screen (Standard §2 `views/FullScreen.tsx`, §8). A CALM FORM:
 * each questionnaire row is a labelled block — the frozen question text as the
 * label, a textarea for the answer, and a per-question save with a quiet "נשמר"
 * confirmation. No add, no delete, no stages: the rows are materialised by the
 * invite sequence, and this tool only answers them.
 *
 * The read is the SHARED react-query cache (`useQuestionnaireList`, queryKey
 * ["questionnaire","list"]) — the same entry the dashboard card reads — so this
 * screen renders from cache and each save reconciles that cache via setQueryData
 * (no refetch), keeping the card's answered count in step. Writes go straight
 * through the SERVER action (`runIntentAction`); every call builds ctx from the
 * session, so no identity is sent from here. A save is gated ROW BY ROW by
 * candidate_answers' `auth_user_can_write`, so it can genuinely succeed (the row is
 * the caller's own answer) — saved optimistically and reconciled to the server's
 * returned row — or genuinely fail, surfaced honestly and never swallowed.
 *
 * EMPTY STATE IS THE NORMAL CASE for anyone who is not the candidate: the answers
 * live in the candidate's child org, so a recruiter's org has none. "No
 * questionnaire here" is honest, not an error.
 *
 * Built from design-system utilities + i18n only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { runIntentAction, type IntentResult } from "@/cortex/actions";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { ChevronIcon, InfoIcon } from "@/components/icons";
import type { QuestionnaireRow } from "../logic";
import { useQuestionnaireList, QUESTIONNAIRE_LIST_KEY } from "@/lib/query/useQuestionnaireList";

/** The failure codes a write can come back with (from {@link IntentResult}). */
type WriteErrorCode = Extract<IntentResult, { ok: false }>["code"];

const inputClass =
  "w-full rounded-md bg-screen px-sm py-sm type-body text-ink outline-none placeholder:text-muted";

// userId/orgId arrive as props (the page called requireSession()) but are NOT sent
// to the action — the server derives identity from the session cookie. `_props`
// marks them deliberately unused here.
export function FullScreen(_props: ToolViewProps) {
  const { t, dir } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { rows, isLoading: loading, isError: loadError } = useQuestionnaireList();
  // Set when a save actually FAILS: "denied"/"unavailable" (the DB refused) vs
  // "failed" (something broke). Never a silent no-op, never a pretend-success.
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);

  // Guards the async setState after a save resolves — a navigation away before it
  // settles must not touch state on an unmounted component. Cache writes via
  // queryClient are safe either way and intentionally NOT gated on this.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Patch one row in the shared cache by id. Functional updater so concurrent saves
  // compose instead of clobbering; `prev ?? []` because the cache can momentarily be
  // undefined (a save racing ahead of the first read).
  const patchRow = useCallback(
    (id: string, patch: (it: QuestionnaireRow) => QuestionnaireRow) => {
      queryClient.setQueryData<QuestionnaireRow[]>(QUESTIONNAIRE_LIST_KEY, (prev) =>
        (prev ?? []).map((it) => (it.id === id ? patch(it) : it)),
      );
    },
    [queryClient],
  );

  // Save one answer. Optimistic: the shared cache takes the new answer first (so the
  // dashboard card's answered count moves in lockstep), then reconciles to the
  // server's authoritative returned row; on failure it reverts and surfaces the
  // code. Returns the failure code (null = success) so the block can show "נשמר".
  const saveAnswer = useCallback(
    async (id: string, answer: string): Promise<WriteErrorCode | null> => {
      const prevList = queryClient.getQueryData<QuestionnaireRow[]>(QUESTIONNAIRE_LIST_KEY) ?? [];
      const prev = prevList.find((it) => it.id === id) ?? null;

      setWriteError(null);
      patchRow(id, (it) => ({ ...it, answer }));

      const res = await runIntentAction("questionnaire.answer", { id, answer });
      if (res.ok) {
        // Reconcile to the server's returned row (authoritative).
        patchRow(id, () => res.data as QuestionnaireRow);
        return null;
      }
      if (prev) patchRow(id, () => prev);
      if (mounted.current) setWriteError(res.code);
      return res.code;
    },
    [patchRow, queryClient],
  );

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
        <h1 className="flex-1 type-title text-ink">{t("questionnaire.name")}</h1>
      </div>

      {writeError ? (
        <p
          role="alert"
          className="flex items-start gap-xs rounded-md bg-danger/10 px-sm py-xs type-label text-danger"
        >
          <InfoIcon width={18} height={18} aria-hidden className="mt-2xs shrink-0" />
          <span>
            {t(writeError === "failed" ? "questionnaire.errorFailed" : "questionnaire.errorDenied")}
          </span>
        </p>
      ) : null}

      {loading ? (
        // Skeleton on the very first load only (cache empty); arriving warm, this
        // never shows. Same block shape as a question.
        <ul className="flex flex-col gap-sm" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex flex-col gap-xs rounded-lg bg-card p-md">
              <span className="h-4 w-48 rounded-md bg-hairline motion-safe:animate-pulse" />
              <span className="h-20 w-full rounded-md bg-hairline motion-safe:animate-pulse" />
            </li>
          ))}
        </ul>
      ) : loadError ? (
        <p className="type-label text-muted">{t("questionnaire.loadFailed")}</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-xs rounded-lg bg-card px-lg py-2xl text-center">
          <p className="type-heading text-ink">{t("questionnaire.emptyTitle")}</p>
          <p className="max-w-[28ch] type-label text-muted">{t("questionnaire.emptyHint")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-sm">
          {rows.map((row) => (
            <li key={row.id}>
              <QuestionBlock row={row} onSave={(answer) => saveAnswer(row.id, answer)} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** One question: the frozen question text as a label, a textarea seeded from the
 * stored answer, and a save button with its own pending state and a quiet "נשמר"
 * that appears on success and fades on the next edit. Owns only its local draft;
 * the parent's `onSave` owns the write + cache reconciliation. */
function QuestionBlock({
  row,
  onSave,
}: {
  row: QuestionnaireRow;
  onSave: (answer: string) => Promise<WriteErrorCode | null>;
}) {
  const { t } = useI18n();
  const [answer, setAnswer] = useState(row.answer);
  // True while this question's save is in flight — disables the button and makes a
  // second submit a no-op.
  const [saving, setSaving] = useState(false);
  // True briefly after a successful save; cleared the moment the user edits again.
  const [saved, setSaved] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    try {
      const code = await onSave(answer);
      if (!mounted.current) return;
      if (code === null) {
        setSaved(true);
        window.setTimeout(() => {
          if (mounted.current) setSaved(false);
        }, 2000);
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-sm rounded-lg bg-card p-md">
      <label className="flex flex-col gap-2xs">
        <span className="type-label text-ink">{row.questionText}</span>
        <textarea
          className={`${inputClass} min-h-24 resize-y`}
          value={answer}
          placeholder={t("questionnaire.answerPlaceholder")}
          rows={3}
          onChange={(e) => {
            setAnswer(e.target.value);
            if (saved) setSaved(false);
          }}
        />
      </label>
      <div className="flex items-center gap-sm">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-md bg-app-blue px-md py-sm type-label text-on-fill interactive disabled:opacity-50 motion-safe:active:scale-[0.97]"
        >
          {saving ? t("questionnaire.saving") : t("questionnaire.save")}
        </button>
        {saved ? (
          <span role="status" className="type-label text-success">
            {t("questionnaire.saved")}
          </span>
        ) : null}
      </div>
    </div>
  );
}
