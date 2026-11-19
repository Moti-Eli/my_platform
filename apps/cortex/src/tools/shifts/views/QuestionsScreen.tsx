"use client";

/**
 * The manager's submission questions (stage 2, part 7) — opened from the bar's
 * hamburger ("Submission questions"):
 *
 *   Built-in questions  the three every employee answers (how many shifts,
 *                       doubles, a note) — read-only here, they live in code.
 *   Your questions      the manager's own: add (text + kind: yes/no, number,
 *                       short text), edit the text inline, reorder (↑ / ↓ —
 *                       as positions), turn on / off. NO delete: an answer must
 *                       stay readable next to the question it answered.
 *
 * Writes are optimistic with a revert on a real failure, one at a time (a
 * reorder touches every row) — the PositionsScreen pattern.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n, type MessageKey } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import { ChevronDownIcon, LockIcon } from "@/components/icons";
import type { QuestionKind, ShiftQuestion } from "../logic";
import { QUESTION_LABEL_MAX } from "../intents";
import { SHIFT_QUESTIONS_KEY, useShiftQuestions } from "@/lib/query/useShiftQuestions";
import {
  AddButton,
  Dialog,
  EmptyCard,
  SKELETON,
  TextField,
  ToolHeader,
  WriteErrorBanner,
  inputClass,
  useMounted,
  type WriteErrorCode,
} from "./shared";

const KINDS: QuestionKind[] = ["yes_no", "number", "text"];
export const kindLabelKey = (kind: QuestionKind): MessageKey =>
  kind === "number" ? "shifts.kindNumber" : kind === "text" ? "shifts.kindText" : "shifts.kindYesNo";

const BUILT_IN: Array<{ labelKey: MessageKey; kindKey: MessageKey }> = [
  { labelKey: "shifts.qShiftsCount", kindKey: "shifts.kindNumber" },
  { labelKey: "shifts.qDouble", kindKey: "shifts.kindYesNo" },
  { labelKey: "shifts.qNote", kindKey: "shifts.kindText" },
];

const arrowButton =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-screen text-ink interactive";

export function QuestionsScreen() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const mounted = useMounted();
  const { questions, isLoading, isError } = useShiftQuestions();

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);
  const [busy, setBusy] = useState(false);

  /** Optimistic cache write; reverts and reports if `write` fails. */
  async function optimistic(
    apply: (prev: ShiftQuestion[]) => ShiftQuestion[],
    write: () => ReturnType<typeof runIntentAction>,
  ) {
    if (busy) return;
    setBusy(true);
    setWriteError(null);
    const snapshot = queryClient.getQueryData<ShiftQuestion[]>(SHIFT_QUESTIONS_KEY);
    queryClient.setQueryData<ShiftQuestion[]>(SHIFT_QUESTIONS_KEY, (prev) => apply(prev ?? []));
    try {
      const res = await write();
      if (!res.ok) {
        queryClient.setQueryData<ShiftQuestion[]>(SHIFT_QUESTIONS_KEY, snapshot);
        if (mounted.current) setWriteError(res.code);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= questions.length) return;
    const ids = questions.map((q) => q.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void optimistic(
      (prev) =>
        prev.map((q) => ({ ...q, position: ids.indexOf(q.id) })).sort((a, b) => a.position - b.position),
      () => runIntentAction("shifts.reorder_questions", { ids }),
    );
  }

  function toggle(q: ShiftQuestion) {
    void optimistic(
      (prev) => prev.map((it) => (it.id === q.id ? { ...it, isActive: !q.isActive } : it)),
      () => runIntentAction("shifts.set_question_active", { id: q.id, isActive: !q.isActive }),
    );
  }

  return (
    <>
      <ToolHeader
        title={t("shifts.menuQuestions")}
        subtitle={t("shifts.name")}
        action={<AddButton label={t("shifts.addQuestion")} onClick={() => setAdding(true)} />}
      />
      <WriteErrorBanner code={writeError} />

      {/* The built-in three — read-only. */}
      <section className="flex flex-col gap-xs rounded-lg bg-card p-md">
        <h2 className="type-heading text-ink">{t("shifts.builtInQuestions")}</h2>
        <p className="type-caption text-muted">{t("shifts.builtInHint")}</p>
        <ul className="flex flex-col divide-y divide-hairline">
          {BUILT_IN.map((q) => (
            <li key={q.labelKey} className="flex items-center gap-xs py-sm">
              <LockIcon width={14} height={14} aria-hidden className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 type-body text-ink">{t(q.labelKey)}</span>
              <span className="shrink-0 type-caption text-muted">{t(q.kindKey)}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* The manager's own. */}
      <section className="flex flex-col gap-xs">
        <h2 className="type-heading text-ink">{t("shifts.yourQuestions")}</h2>
        {isLoading ? (
          <ul className="flex flex-col gap-xs" aria-hidden="true">
            {[0, 1].map((i) => (
              <li key={i} className={`h-14 ${SKELETON}`} />
            ))}
          </ul>
        ) : isError ? (
          <EmptyCard titleKey="shifts.loadFailed" />
        ) : questions.length === 0 ? (
          <EmptyCard
            titleKey="shifts.noQuestionsYet"
            action={<AddButton label={t("shifts.addQuestion")} onClick={() => setAdding(true)} />}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-hairline rounded-lg bg-card px-md">
            {questions.map((q, index) =>
              editingId === q.id ? (
                <li key={q.id} className="py-sm">
                  <LabelEditor
                    initial={q.label}
                    onCancel={() => setEditingId(null)}
                    onSave={async (label) => {
                      const res = await runIntentAction("shifts.rename_question", { id: q.id, label });
                      if (!res.ok) return res.code;
                      queryClient.setQueryData<ShiftQuestion[]>(SHIFT_QUESTIONS_KEY, (prev) =>
                        (prev ?? []).map((it) => (it.id === q.id ? { ...it, label } : it)),
                      );
                      setEditingId(null);
                      return null;
                    }}
                  />
                </li>
              ) : (
                <li key={q.id} className="flex flex-col gap-2xs py-sm">
                  <div className="flex items-start gap-xs">
                    <button
                      type="button"
                      onClick={() => setEditingId(q.id)}
                      aria-label={`${t("shifts.edit")}: ${q.label}`}
                      className={`min-w-0 flex-1 text-start type-body interactive ${q.isActive ? "text-ink" : "text-muted"}`}
                    >
                      {q.label}
                    </button>
                    <button
                      type="button"
                      aria-label={t("shifts.moveUp")}
                      onClick={() => move(index, -1)}
                      disabled={busy || index === 0}
                      className={`${arrowButton} ${index === 0 ? "opacity-[var(--ds-disabled-opacity)]" : ""}`}
                    >
                      <ChevronDownIcon width={16} height={16} className="rotate-180" />
                    </button>
                    <button
                      type="button"
                      aria-label={t("shifts.moveDown")}
                      onClick={() => move(index, 1)}
                      disabled={busy || index === questions.length - 1}
                      className={`${arrowButton} ${
                        index === questions.length - 1 ? "opacity-[var(--ds-disabled-opacity)]" : ""
                      }`}
                    >
                      <ChevronDownIcon width={16} height={16} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-xs">
                    <span className="flex items-center gap-xs type-caption text-muted">
                      {t(kindLabelKey(q.kind))}
                      {!q.isActive ? (
                        <span className="rounded-pill bg-screen px-xs py-2xs text-muted">{t("shifts.questionOff")}</span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      aria-pressed={q.isActive}
                      aria-label={`${t(q.isActive ? "shifts.turnOff" : "shifts.turnOn")}: ${q.label}`}
                      onClick={() => toggle(q)}
                      disabled={busy}
                      className={`shrink-0 rounded-pill px-sm py-2xs type-label interactive motion-safe:active:scale-[0.97] ${
                        q.isActive ? "bg-app-coral/15 text-app-coral" : "bg-screen text-ink"
                      }`}
                    >
                      {t(q.isActive ? "shifts.turnOff" : "shifts.turnOn")}
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      {adding ? (
        <AddQuestionDialog
          onClose={() => setAdding(false)}
          onAdd={async (label, kind) => {
            const res = await runIntentAction("shifts.create_question", { label, kind });
            if (!res.ok) return res.code;
            const created = res.data as ShiftQuestion;
            queryClient.setQueryData<ShiftQuestion[]>(SHIFT_QUESTIONS_KEY, (prev) => [...(prev ?? []), created]);
            return null;
          }}
        />
      ) : null}
    </>
  );
}

/** Inline text editor for one question's label. */
function LabelEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (label: string) => Promise<WriteErrorCode | null>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const mounted = useMounted();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<WriteErrorCode | null>(null);
  const clean = value.replace(/\s+/g, " ").trim();

  async function save() {
    if (clean === "" || saving) return;
    if (clean === initial) {
      onCancel();
      return;
    }
    setSaving(true);
    const code = await onSave(clean);
    if (!mounted.current) return;
    setSaving(false);
    setError(code);
  }

  return (
    <form
      className="flex flex-col gap-xs"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <input
        autoFocus
        value={value}
        maxLength={QUESTION_LABEL_MAX}
        aria-label={t("shifts.questionLabel")}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        className={inputClass}
      />
      <WriteErrorBanner code={error} />
      <div className="flex justify-end gap-xs">
        <button type="button" onClick={onCancel} className="rounded-pill px-md py-xs type-label text-muted interactive">
          {t("shifts.cancel")}
        </button>
        <button
          type="submit"
          disabled={saving || clean === ""}
          className="rounded-pill bg-app-coral px-md py-xs type-label text-on-fill interactive"
        >
          {t("shifts.save")}
        </button>
      </div>
    </form>
  );
}

/** "Add question": its text and kind. */
function AddQuestionDialog({
  onAdd,
  onClose,
}: {
  onAdd: (label: string, kind: QuestionKind) => Promise<WriteErrorCode | null>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const mounted = useMounted();
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<QuestionKind>("yes_no");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<WriteErrorCode | null>(null);
  const clean = label.replace(/\s+/g, " ").trim();

  async function submit() {
    if (clean === "" || saving) return;
    setSaving(true);
    const code = await onAdd(clean, kind);
    if (!mounted.current) return;
    setSaving(false);
    if (code) setError(code);
    else onClose();
  }

  return (
    <Dialog title={t("shifts.addQuestion")} onClose={onClose}>
      <form
        className="flex flex-col gap-md"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <TextField
          label={t("shifts.questionLabel")}
          value={label}
          onChange={setLabel}
          maxLength={QUESTION_LABEL_MAX}
          required
        />
        <div className="flex flex-col gap-2xs">
          <span className="type-label text-muted">{t("shifts.questionKind")}</span>
          <div role="radiogroup" aria-label={t("shifts.questionKind")} className="grid grid-cols-3 gap-2xs">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={`flex h-10 items-center justify-center rounded-pill px-xs type-label interactive ${
                  kind === k ? "bg-app-coral text-on-fill" : "bg-screen text-ink"
                }`}
              >
                {t(kindLabelKey(k))}
              </button>
            ))}
          </div>
        </div>
        <WriteErrorBanner code={error} />
        <div className="flex justify-end gap-xs">
          <button type="button" onClick={onClose} className="rounded-pill px-md py-xs type-label text-muted interactive">
            {t("shifts.cancel")}
          </button>
          <button
            type="submit"
            disabled={saving || clean === ""}
            className="rounded-pill bg-app-coral px-md py-xs type-label text-on-fill interactive"
          >
            {t("shifts.add")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
