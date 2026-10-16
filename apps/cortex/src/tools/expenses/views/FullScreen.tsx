"use client";

/**
 * Expenses full screen (Standard §2 `views/FullScreen.tsx`, §8). Cloned from Notes'
 * full screen, on the app-green identity accent.
 *
 * Expense list with an add action, an inline per-row EDIT (amount, category, date,
 * note), and a per-row delete. The read is the SHARED react-query cache
 * (`useExpensesList`, queryKey ["expenses","list"]) — the same entry the dashboard
 * card reads — so this screen renders from cache and each write reconciles that
 * cache via setQueryData (no refetch). Writes go straight through the SERVER action
 * (`runIntentAction`); every call — read or write — builds ctx from the session, so
 * no identity is sent from here.
 *
 * WRITES WORK (20260717000010 opened the path, mirroring notes). A write flows
 * runIntentAction -> the server data-layer -> the RLS client, gated ROW BY ROW by
 * `private.auth_user_can_write`: membership in the row's org tree is the gate. A
 * write can genuinely succeed — so this screen edits/deletes OPTIMISTICALLY and
 * reconciles to the server's authoritative answer — or genuinely fail, in which
 * case the failure is surfaced honestly, never faked and never swallowed.
 *
 * Built from design-system utilities + i18n only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { runIntentAction, type IntentResult } from "@/cortex/actions";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { ChevronIcon, CloseIcon, InfoIcon } from "@/components/icons";
import { type Expense, formatAmount } from "../logic";
import { useExpensesList, EXPENSES_LIST_KEY } from "@/lib/query/useExpensesList";

/** The failure codes a write can come back with (from {@link IntentResult}). */
type WriteErrorCode = Extract<IntentResult, { ok: false }>["code"];

/** The editable fields of an expense, as the forms hand them back. */
interface ExpenseDraft {
  amount: number;
  category: string;
  spentOn: string;
  note: string;
}

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
  const { expenses } = useExpensesList();
  const [adding, setAdding] = useState(false);
  // Which expense is being edited inline (null = none). Only one row edits at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
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

  // In-flight EDITS, keyed by expense id. A second save for an expense whose write
  // is still running is ignored, so a double-tap can't double-apply. This is
  // PER-EXPENSE, not a global lock. The ref is the synchronous source of truth for
  // the guard (reading `saving` state would be stale within a burst of taps).
  const savingRef = useRef<Set<string>>(new Set());

  // In-flight DELETES, keyed by expense id — a SEPARATE guard from the edit set
  // above, so an edit and a delete never share a lock. Mirrors notes' `deleting`.
  const deletingRef = useRef<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(deletingRef.current);
  // Which row is mid two-tap delete confirm (null = none). Tapping a different row's
  // trash moves the confirm there; a second tap on the SAME row commits the delete.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Patch one row in the shared cache by id. Functional updater, so concurrent
  // in-flight writes compose instead of clobbering. `prev ?? []` because the cache
  // can momentarily be undefined (a write racing ahead of the first read).
  const patchExpense = useCallback(
    (id: string, patch: (it: Expense) => Expense) => {
      queryClient.setQueryData<Expense[]>(EXPENSES_LIST_KEY, (prev) =>
        (prev ?? []).map((it) => (it.id === id ? patch(it) : it)),
      );
    },
    [queryClient],
  );

  const saveExpense = useCallback(
    async (id: string, next: ExpenseDraft) => {
      // 0. GUARD double-submit: ignore a save for an expense whose write is still in
      //    flight. The ref check is synchronous, so it catches a second tap in the
      //    micro-window before the disabled button re-renders.
      if (savingRef.current.has(id)) return;

      // Snapshot the row BEFORE editing, so a failure can restore it exactly.
      const prevList = queryClient.getQueryData<Expense[]>(EXPENSES_LIST_KEY) ?? [];
      const prev = prevList.find((it) => it.id === id) ?? null;

      savingRef.current = new Set(savingRef.current).add(id);

      // 1. OPTIMISTIC: write the new fields straight into the SHARED cache, before
      //    awaiting, so the edit has instant feedback AND the dashboard card
      //    (reading the same cache, including its total) moves in lockstep.
      setWriteError(null);
      patchExpense(id, (it) => ({ ...it, ...next }));

      try {
        const res = await runIntentAction("expenses.update_expense", { id, ...next });

        if (res.ok) {
          // 2. Success: close the inline editor. Nothing to reconcile — the cache
          //    already holds exactly what we submitted, which is authoritative.
          if (mounted.current) setEditingId((cur) => (cur === id ? null : cur));
        } else {
          // 3. REVERT to the snapshot and surface the real error; leave the editor
          //    open so the edit isn't lost. The cache is written only on these
          //    chosen paths, so a failure leaves it consistent — never corrupted.
          if (prev) patchExpense(id, () => prev);
          if (mounted.current) setWriteError(res.code);
        }
      } finally {
        // Clear the in-flight mark whether the write succeeded, failed, or threw.
        const cleared = new Set(savingRef.current);
        cleared.delete(id);
        savingRef.current = cleared;
      }
    },
    [patchExpense, queryClient],
  );

  const removeExpense = useCallback(
    async (id: string) => {
      // 0. GUARD double-delete (mirrors saveExpense's in-flight guard): ignore a
      //    delete for an expense whose delete is already running.
      if (deletingRef.current.has(id)) return;

      // Snapshot the row AND its index from the cache BEFORE removing, so a failure
      // can restore it exactly where it was.
      const prevList = queryClient.getQueryData<Expense[]>(EXPENSES_LIST_KEY) ?? [];
      const index = prevList.findIndex((it) => it.id === id);
      const removed = index >= 0 ? prevList[index] : null;

      const nextDeleting = new Set(deletingRef.current).add(id);
      deletingRef.current = nextDeleting;
      setDeleting(nextDeleting);

      // 1. OPTIMISTIC: drop the row from the SHARED cache immediately, so the
      //    dashboard card (reading the same cache) drops it in lockstep.
      setWriteError(null);
      queryClient.setQueryData<Expense[]>(EXPENSES_LIST_KEY, (prev) =>
        (prev ?? []).filter((it) => it.id !== id),
      );

      try {
        const res = await runIntentAction("expenses.delete_expense", { id });
        // 2. On success: leave it removed — nothing to reconcile.
        if (!res.ok) {
          // 3. REVERT: re-insert the removed row at its original position and
          //    surface the error via the existing writeError alert. The cache is
          //    written only on these chosen paths, so a failure leaves it consistent.
          if (removed) {
            queryClient.setQueryData<Expense[]>(EXPENSES_LIST_KEY, (prev) => {
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
        <h1 className="flex-1 type-title text-ink">{t("expenses.name")}</h1>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-pill bg-app-green px-md py-xs type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
        >
          {t("expenses.addExpense")}
        </button>
      </div>

      {writeError ? (
        <p
          role="alert"
          className="flex items-start gap-xs rounded-md bg-danger/10 px-sm py-xs type-label text-danger"
        >
          <InfoIcon width={18} height={18} aria-hidden className="mt-2xs shrink-0" />
          <span>
            {t(writeError === "failed" ? "expenses.errorFailed" : "expenses.errorDenied")}
          </span>
        </p>
      ) : null}

      {adding ? (
        <AddExpenseForm
          onCreated={(expense) => {
            // create_expense returns { id }; the rest of the row is exactly what we
            // submitted, so append it straight into the SHARED cache — no refetch,
            // and the dashboard card (total included) sees the new expense immediately.
            queryClient.setQueryData<Expense[]>(EXPENSES_LIST_KEY, (prev) => [
              expense,
              ...(prev ?? []),
            ]);
            setAdding(false);
            setWriteError(null);
          }}
          onError={(code) => setWriteError(code)}
        />
      ) : null}

      {expenses.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-xs rounded-lg bg-card px-lg py-2xl text-center">
          <p className="type-heading text-ink">{t("expenses.emptyTitle")}</p>
          <p className="max-w-[24ch] type-label text-muted">{t("expenses.emptyHint")}</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {expenses.map((expense) => {
            const rowDeleting = deleting.has(expense.id);
            const confirming = confirmId === expense.id;

            // Editing: the whole row becomes an inline edit form.
            if (editingId === expense.id) {
              return (
                <li key={expense.id} className="py-sm">
                  <EditExpenseForm
                    expense={expense}
                    onSave={(next) => saveExpense(expense.id, next)}
                    onCancel={() => setEditingId(null)}
                  />
                </li>
              );
            }

            return (
              <li key={expense.id} className="flex items-center gap-sm py-sm">
                <button
                  type="button"
                  aria-label={t("expenses.editExpense")}
                  onClick={() => {
                    setConfirmId(null);
                    setEditingId(expense.id);
                  }}
                  disabled={rowDeleting}
                  className="flex min-w-0 flex-1 flex-col items-start gap-2xs text-start interactive motion-safe:active:scale-[0.99]"
                >
                  <span className="flex w-full items-center justify-between gap-sm">
                    <span className="truncate type-heading text-ink" dir="ltr">
                      {formatAmount(expense.amount)}
                    </span>
                    <span className="shrink-0 truncate type-label text-muted">
                      {expense.category}
                    </span>
                  </span>
                  <span className="type-label text-muted" dir="ltr">
                    {expense.spentOn}
                  </span>
                </button>

                {/* Delete — a two-tap inline confirm (no modal, no window.confirm):
                    first tap arms "Delete?", a second tap commits. Tapping another
                    row's trash moves the confirm there. */}
                {confirming ? (
                  <button
                    type="button"
                    aria-label={t("expenses.confirmDelete")}
                    onClick={() => {
                      setConfirmId(null);
                      void removeExpense(expense.id);
                    }}
                    disabled={rowDeleting}
                    className="shrink-0 rounded-pill bg-danger px-sm py-2xs type-caption text-on-fill interactive motion-safe:active:scale-[0.97]"
                  >
                    {t("expenses.confirmDelete")}
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={t("expenses.delete")}
                    onClick={() => setConfirmId(expense.id)}
                    disabled={rowDeleting}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-hairline text-muted interactive motion-safe:active:scale-[0.97]"
                  >
                    <CloseIcon width={16} height={16} />
                  </button>
                )}
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

/** Today as an ISO date (YYYY-MM-DD) — the default for the date input. */
function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Parse the amount input to a positive number, or null if it isn't one. Shared by
 * the add + edit forms so both validate identically. */
function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function AddExpenseForm({
  onCreated,
  onError,
}: {
  onCreated: (expense: Expense) => void;
  onError: (code: WriteErrorCode) => void;
}) {
  const { t } = useI18n();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [spentOn, setSpentOn] = useState(todayInput);
  const [note, setNote] = useState("");
  // Whether the required amount is invalid on submit (blank or not a positive
  // number). Drives the marking + message; cleared as soon as the user edits it.
  const [invalid, setInvalid] = useState<{ amount: boolean }>({ amount: false });
  // True while an add is in flight. Disables the submit button and makes a second
  // submit a no-op, so a double-tap can't write a duplicate row.
  const [submitting, setSubmitting] = useState(false);

  // Guard: onCreated/onError setState in the PARENT after the await. If we unmount
  // mid-submit, this stops us from touching the parent's state.
  const mounted = useRef(true);
  useEffect(() => {
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

    // Required-field validation is VISIBLE now — an invalid amount marks itself and
    // says what is wrong, instead of the submit silently doing nothing.
    const parsedAmount = parseAmount(amount);
    const nextInvalid = { amount: parsedAmount === null };
    setInvalid(nextInvalid);
    if (parsedAmount === null) return;

    // The optional fields fall back to the SAME values the logic/column defaults
    // give, so the row we hand up matches what the server stored.
    const nextCategory = category.trim() === "" ? "general" : category.trim();
    const nextSpentOn = spentOn.trim() === "" ? todayInput() : spentOn;
    const nextNote = note.trim();

    setSubmitting(true);
    try {
      // No ctx argument — the server builds it from the session.
      const res = await runIntentAction("expenses.create_expense", {
        amount: parsedAmount,
        category: nextCategory,
        spentOn: nextSpentOn,
        note: nextNote === "" ? undefined : nextNote,
      });
      if (!mounted.current) return;

      if (res.ok) {
        // create_expense returns only { id }; the rest of the Expense is the values
        // we just submitted, so we can hand a complete row up to prepend.
        const { id } = res.data as { id: string };
        onCreated({
          id,
          amount: parsedAmount,
          category: nextCategory,
          spentOn: nextSpentOn,
          note: nextNote,
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
          {t("expenses.amount")} <span aria-hidden="true" className="text-danger">*</span>
        </span>
        <input
          className={invalid.amount ? `${inputClass} ${invalidRing}` : inputClass}
          value={amount}
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          placeholder={t("expenses.amountPlaceholder")}
          onChange={(e) => {
            setAmount(e.target.value);
            if (invalid.amount) setInvalid((v) => ({ ...v, amount: false }));
          }}
          aria-required="true"
          aria-invalid={invalid.amount}
          dir="ltr"
        />
        {invalid.amount ? (
          <span role="alert" className="type-caption text-danger">
            {t("expenses.amountInvalid")}
          </span>
        ) : null}
      </label>
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("expenses.category")}
        <input
          className={inputClass}
          value={category}
          placeholder={t("expenses.categoryPlaceholder")}
          onChange={(e) => setCategory(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("expenses.spentOn")}
        <input
          className={inputClass}
          type="date"
          value={spentOn}
          onChange={(e) => setSpentOn(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("expenses.note")}
        <textarea
          className={`${inputClass} min-h-24 resize-y`}
          value={note}
          placeholder={t("expenses.notePlaceholder")}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-app-green py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
      >
        {t("expenses.add")}
      </button>
    </form>
  );
}

function EditExpenseForm({
  expense,
  onSave,
  onCancel,
}: {
  expense: Expense;
  onSave: (next: ExpenseDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [amount, setAmount] = useState(() => formatAmount(expense.amount));
  const [category, setCategory] = useState(expense.category);
  const [spentOn, setSpentOn] = useState(expense.spentOn);
  const [note, setNote] = useState(expense.note);
  const [invalid, setInvalid] = useState<{ amount: boolean }>({ amount: false });
  // True while a save is in flight. Disables submit and makes a second submit a
  // no-op (the parent's saveExpense also guards per-id — belt-and-suspenders).
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

    const parsedAmount = parseAmount(amount);
    const nextInvalid = { amount: parsedAmount === null };
    setInvalid(nextInvalid);
    if (parsedAmount === null) return;

    const nextCategory = category.trim() === "" ? "general" : category.trim();
    const nextSpentOn = spentOn.trim() === "" ? todayInput() : spentOn;
    const nextNote = note.trim();

    setSubmitting(true);
    try {
      await onSave({
        amount: parsedAmount,
        category: nextCategory,
        spentOn: nextSpentOn,
        note: nextNote,
      });
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-sm rounded-lg bg-card p-md">
      <label className="flex flex-col gap-2xs type-label text-muted">
        <span>
          {t("expenses.amount")} <span aria-hidden="true" className="text-danger">*</span>
        </span>
        <input
          className={invalid.amount ? `${inputClass} ${invalidRing}` : inputClass}
          value={amount}
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          placeholder={t("expenses.amountPlaceholder")}
          onChange={(e) => {
            setAmount(e.target.value);
            if (invalid.amount) setInvalid((v) => ({ ...v, amount: false }));
          }}
          aria-required="true"
          aria-invalid={invalid.amount}
          dir="ltr"
        />
        {invalid.amount ? (
          <span role="alert" className="type-caption text-danger">
            {t("expenses.amountInvalid")}
          </span>
        ) : null}
      </label>
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("expenses.category")}
        <input
          className={inputClass}
          value={category}
          placeholder={t("expenses.categoryPlaceholder")}
          onChange={(e) => setCategory(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("expenses.spentOn")}
        <input
          className={inputClass}
          type="date"
          value={spentOn}
          onChange={(e) => setSpentOn(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("expenses.note")}
        <textarea
          className={`${inputClass} min-h-24 resize-y`}
          value={note}
          placeholder={t("expenses.notePlaceholder")}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="flex items-center gap-sm">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-md bg-app-green py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
        >
          {t("expenses.save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-md bg-hairline px-md py-sm type-label text-ink interactive motion-safe:active:scale-[0.97]"
        >
          {t("expenses.cancel")}
        </button>
      </div>
    </form>
  );
}
