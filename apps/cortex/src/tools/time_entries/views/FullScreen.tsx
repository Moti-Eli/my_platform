"use client";

/**
 * Time-entries full screen (Standard §2 `views/FullScreen.tsx`, §8). Cloned from
 * Journal's full screen, on the app-teal identity accent.
 *
 * Entry list with an add action, an inline per-row EDIT (hours, date, note), and a
 * per-row delete. The read is the SHARED react-query cache (`useTimeEntriesList`,
 * queryKey ["time_entries","list"]) — the same entry the dashboard card reads — so
 * this screen renders from cache and each write reconciles that cache via
 * setQueryData (no refetch). Writes go straight through the SERVER action
 * (`runIntentAction`); every call — read or write — builds ctx from the session, so
 * no identity is sent from here.
 *
 * WRITES WORK (20260723000004 opened the path; born-private). A write flows
 * runIntentAction -> the server data-layer -> the RLS client, gated ROW BY ROW by
 * `private.auth_user_can_write` (owner-only on 'private'): the row's owner is the
 * gate. A write can genuinely succeed — so this screen edits/deletes OPTIMISTICALLY
 * and reconciles to the server's authoritative answer — or genuinely fail, in which
 * case the failure is surfaced honestly, never faked and never swallowed.
 *
 * HOURS DOMAIN (0, 24] is validated HERE too (visible), mirroring how journal
 * validates its required field — the DB CHECK and the intent schema are the
 * enforcement points; this just refuses a bad value before the round-trip.
 *
 * Built from design-system utilities + i18n only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { runIntentAction, type IntentResult } from "@/cortex/actions";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { ChevronIcon, CloseIcon, InfoIcon } from "@/components/icons";
import type { TimeEntry } from "../logic";
import { useTimeEntriesList, TIME_ENTRIES_LIST_KEY } from "@/lib/query/useTimeEntriesList";
import { useStaffMembers } from "@/lib/query/useStaffMembers";

/** The failure codes a write can come back with (from {@link IntentResult}). */
type WriteErrorCode = Extract<IntentResult, { ok: false }>["code"];

/** The editable fields of an entry, as the forms hand them back. `hours` is already
 * validated to (0, 24]; `note` is the raw (possibly empty) string — an empty note is
 * stored as '' and rendered as none. */
interface EntryDraft {
  hours: number;
  workDate: string;
  note: string;
}

// userId/orgId arrive as props (the page called requireSession()). Neither is
// sent to the action — the server derives identity from the session cookie. But
// `userId` IS used locally now: it stamps the owner on the optimistic create row
// (the fresh row's owner is, by definition, the current user), so a manager view
// grouping by ownerId sees the correct owner before react-query revalidates.
// `orgId` remains deliberately unused (the page provides it; the server owns it).
//
// `isAdmin` ONLY branches the UI (it reveals the "team" tab) — it is NOT a security
// boundary. RLS is: a non-admin's query returns only THEIR OWN rows regardless of
// this flag, so the team grouping could never show anyone else's hours even if the
// flag were forced true. The prop is widened LOCALLY here (ToolViewProps &
// { isAdmin }); the shared ToolViewProps type is deliberately left untouched.
export function FullScreen({ userId, isAdmin }: ToolViewProps & { isAdmin: boolean }) {
  const { t, dir } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  // The READ: straight from the shared query cache — this screen is a reader of the
  // SAME entry the dashboard card reads. It renders from the cache (the single
  // source of truth) and writes back into it via setQueryData, so the two views can
  // never hold diverging copies. Arriving from the card, the cache is warm and the
  // list paints instantly; react-query revalidates in the background.
  const { entries } = useTimeEntriesList();
  const [adding, setAdding] = useState(false);
  // Which view an ADMIN is looking at: their OWN entries (default — identical to the
  // non-admin screen) or the TEAM overview. Non-admins never see the toggle, so this
  // stays "mine" for them and the screen is byte-for-byte today's.
  const [tab, setTab] = useState<"mine" | "team">("mine");
  // Which entry is being edited inline (null = none). Only one row edits at a time.
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

  // In-flight EDITS, keyed by entry id. A second save for an entry whose write is
  // still running is ignored, so a double-tap can't double-apply. This is PER-ENTRY,
  // not a global lock. The ref is the synchronous source of truth for the guard
  // (reading `saving` state would be stale within a burst of taps).
  const savingRef = useRef<Set<string>>(new Set());

  // In-flight DELETES, keyed by entry id — a SEPARATE guard from the edit set above,
  // so an edit and a delete never share a lock. Mirrors journal's `deleting`.
  const deletingRef = useRef<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(deletingRef.current);
  // Which row is mid two-tap delete confirm (null = none). Tapping a different row's
  // trash moves the confirm there; a second tap on the SAME row commits the delete.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Patch one row in the shared cache by id. Functional updater, so concurrent
  // in-flight writes compose instead of clobbering. `prev ?? []` because the cache
  // can momentarily be undefined (a write racing ahead of the first read).
  const patchEntry = useCallback(
    (id: string, patch: (it: TimeEntry) => TimeEntry) => {
      queryClient.setQueryData<TimeEntry[]>(TIME_ENTRIES_LIST_KEY, (prev) =>
        (prev ?? []).map((it) => (it.id === id ? patch(it) : it)),
      );
    },
    [queryClient],
  );

  const saveEntry = useCallback(
    async (id: string, next: EntryDraft) => {
      // 0. GUARD double-submit: ignore a save for an entry whose write is still in
      //    flight. The ref check is synchronous, so it catches a second tap in the
      //    micro-window before the disabled button re-renders.
      if (savingRef.current.has(id)) return;

      // Snapshot the row BEFORE editing, so a failure can restore it exactly.
      const prevList = queryClient.getQueryData<TimeEntry[]>(TIME_ENTRIES_LIST_KEY) ?? [];
      const prev = prevList.find((it) => it.id === id) ?? null;

      savingRef.current = new Set(savingRef.current).add(id);

      // 1. OPTIMISTIC: write the new fields straight into the SHARED cache, before
      //    awaiting, so the edit has instant feedback AND the dashboard card
      //    (reading the same cache) moves in lockstep. An empty note renders as none.
      setWriteError(null);
      patchEntry(id, (it) => ({ ...it, ...next }));

      try {
        const res = await runIntentAction("time_entries.update_entry", { id, ...next });

        if (res.ok) {
          // 2. Success: close the inline editor. Nothing to reconcile — the cache
          //    already holds exactly what we submitted, which is authoritative.
          if (mounted.current) setEditingId((cur) => (cur === id ? null : cur));
        } else {
          // 3. REVERT to the snapshot and surface the real error; leave the editor
          //    open so the edit isn't lost. The cache is written only on these
          //    chosen paths, so a failure leaves it consistent — never corrupted.
          if (prev) patchEntry(id, () => prev);
          if (mounted.current) setWriteError(res.code);
        }
      } finally {
        // Clear the in-flight mark whether the write succeeded, failed, or threw.
        const cleared = new Set(savingRef.current);
        cleared.delete(id);
        savingRef.current = cleared;
      }
    },
    [patchEntry, queryClient],
  );

  const removeEntry = useCallback(
    async (id: string) => {
      // 0. GUARD double-delete (mirrors saveEntry's in-flight guard): ignore a
      //    delete for an entry whose delete is already running.
      if (deletingRef.current.has(id)) return;

      // Snapshot the row AND its index from the cache BEFORE removing, so a failure
      // can restore it exactly where it was.
      const prevList = queryClient.getQueryData<TimeEntry[]>(TIME_ENTRIES_LIST_KEY) ?? [];
      const index = prevList.findIndex((it) => it.id === id);
      const removed = index >= 0 ? prevList[index] : null;

      const nextDeleting = new Set(deletingRef.current).add(id);
      deletingRef.current = nextDeleting;
      setDeleting(nextDeleting);

      // 1. OPTIMISTIC: drop the row from the SHARED cache immediately, so the
      //    dashboard card (reading the same cache) drops it in lockstep.
      setWriteError(null);
      queryClient.setQueryData<TimeEntry[]>(TIME_ENTRIES_LIST_KEY, (prev) =>
        (prev ?? []).filter((it) => it.id !== id),
      );

      try {
        const res = await runIntentAction("time_entries.delete_entry", { id });
        // 2. On success: leave it removed — nothing to reconcile.
        if (!res.ok) {
          // 3. REVERT: re-insert the removed row at its original position and
          //    surface the error via the existing writeError alert. The cache is
          //    written only on these chosen paths, so a failure leaves it consistent.
          if (removed) {
            queryClient.setQueryData<TimeEntry[]>(TIME_ENTRIES_LIST_KEY, (prev) => {
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
        <h1 className="flex-1 type-title text-ink">{t("time_entries.name")}</h1>
        {/* Adding is a "my entries" affordance — hidden in the read-only team view. */}
        {tab === "mine" ? (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded-pill bg-app-teal px-md py-xs type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
          >
            {t("time_entries.addEntry")}
          </button>
        ) : null}
      </div>

      {writeError ? (
        <p
          role="alert"
          className="flex items-start gap-xs rounded-md bg-danger/10 px-sm py-xs type-label text-danger"
        >
          <InfoIcon width={18} height={18} aria-hidden className="mt-2xs shrink-0" />
          <span>
            {t(writeError === "failed" ? "time_entries.errorFailed" : "time_entries.errorDenied")}
          </span>
        </p>
      ) : null}

      {/* ADMIN-ONLY view toggle — sits above the list. "My entries" is the exact
          non-admin screen; "Team" is the grouped overview. Non-admins never see it. */}
      {isAdmin ? (
        <div
          role="tablist"
          aria-label={t("time_entries.name")}
          className="flex w-fit items-center gap-2xs rounded-pill bg-card p-2xs"
        >
          {(["mine", "team"] as const).map((key) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(key)}
                className={`rounded-pill px-md py-2xs type-label interactive motion-safe:active:scale-[0.97] ${
                  active ? "bg-app-teal text-on-fill" : "text-muted"
                }`}
              >
                {t(key === "mine" ? "time_entries.tabMine" : "time_entries.tabTeam")}
              </button>
            );
          })}
        </div>
      ) : null}

      {tab === "mine" && adding ? (
        <AddEntryForm
          userId={userId}
          onCreated={(entry) => {
            // create_entry returns { id }; the rest of the row is exactly what we
            // submitted, so prepend it straight into the SHARED cache — no refetch,
            // and the dashboard card sees the new entry immediately. Newest-first
            // matches the server ordering (work_date desc, created_at desc).
            queryClient.setQueryData<TimeEntry[]>(TIME_ENTRIES_LIST_KEY, (prev) => [
              entry,
              ...(prev ?? []),
            ]);
            setAdding(false);
            setWriteError(null);
          }}
          onError={(code) => setWriteError(code)}
        />
      ) : null}

      {tab === "team" ? (
        <TeamView entries={entries} />
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-xs rounded-lg bg-card px-lg py-2xl text-center">
          <p className="type-heading text-ink">{t("time_entries.emptyTitle")}</p>
          <p className="max-w-[24ch] type-label text-muted">{t("time_entries.emptyHint")}</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {entries.map((entry) => {
            const rowDeleting = deleting.has(entry.id);
            const confirming = confirmId === entry.id;

            // Editing: the whole row becomes an inline edit form.
            if (editingId === entry.id) {
              return (
                <li key={entry.id} className="py-sm">
                  <EditEntryForm
                    entry={entry}
                    onSave={(next) => saveEntry(entry.id, next)}
                    onCancel={() => setEditingId(null)}
                  />
                </li>
              );
            }

            return (
              <li key={entry.id} className="flex items-center gap-sm py-sm">
                <button
                  type="button"
                  aria-label={t("time_entries.editEntry")}
                  onClick={() => {
                    setConfirmId(null);
                    setEditingId(entry.id);
                  }}
                  disabled={rowDeleting}
                  className="flex min-w-0 flex-1 flex-col items-start gap-2xs text-start interactive motion-safe:active:scale-[0.99]"
                >
                  <span className="flex w-full items-center justify-between gap-sm">
                    <span className="truncate type-heading text-ink" dir="ltr">
                      {entry.hours} {t("time_entries.hoursUnit")}
                    </span>
                    <span className="shrink-0 type-label text-muted" dir="ltr">
                      {entry.workDate}
                    </span>
                  </span>
                  {entry.note ? (
                    <span className="w-full truncate type-label text-muted">{entry.note}</span>
                  ) : null}
                </button>

                {/* Delete — a two-tap inline confirm (no modal, no window.confirm):
                    first tap arms "Delete?", a second tap commits. Tapping another
                    row's trash moves the confirm there. */}
                {confirming ? (
                  <button
                    type="button"
                    aria-label={t("time_entries.confirmDelete")}
                    onClick={() => {
                      setConfirmId(null);
                      void removeEntry(entry.id);
                    }}
                    disabled={rowDeleting}
                    className="shrink-0 rounded-pill bg-danger px-sm py-2xs type-caption text-on-fill interactive motion-safe:active:scale-[0.97]"
                  >
                    {t("time_entries.confirmDelete")}
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={t("time_entries.delete")}
                    onClick={() => setConfirmId(entry.id)}
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

/** Validate a raw hours string against the (0, 24] domain (mirrors the DB CHECK
 * and the intent schema). Returns null when valid, or which failure it is so the
 * form can show the RIGHT message: "required" (blank) vs "range" (out of bounds). */
function hoursErrorOf(raw: string): "required" | "range" | null {
  const trimmed = raw.trim();
  if (trimmed === "") return "required";
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num <= 0 || num > 24) return "range";
  return null;
}

function AddEntryForm({
  userId,
  onCreated,
  onError,
}: {
  userId: string;
  onCreated: (entry: TimeEntry) => void;
  onError: (code: WriteErrorCode) => void;
}) {
  const { t } = useI18n();
  const [hours, setHours] = useState("");
  const [workDate, setWorkDate] = useState(todayInput);
  const [note, setNote] = useState("");
  // Which hours failure to show (null = valid). Drives the marking + message;
  // cleared as soon as the user edits the field.
  const [hoursError, setHoursError] = useState<"required" | "range" | null>(null);
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

    // Required-field + domain validation is VISIBLE now — bad hours mark themselves
    // and say what is wrong, instead of the submit silently doing nothing.
    const err = hoursErrorOf(hours);
    setHoursError(err);
    if (err) return;
    const nextHours = Number(hours.trim());

    // The optional fields fall back to the SAME values the logic/column defaults give.
    const nextDate = workDate.trim() === "" ? todayInput() : workDate;
    const nextNote = note.trim();

    setSubmitting(true);
    try {
      // No ctx argument — the server builds it from the session.
      const res = await runIntentAction("time_entries.create_entry", {
        hours: nextHours,
        workDate: nextDate,
        note: nextNote === "" ? undefined : nextNote,
      });
      if (!mounted.current) return;

      if (res.ok) {
        // create_entry returns only { id }; the rest of the TimeEntry is the values
        // we just submitted, so we can hand a complete row up to prepend.
        const { id } = res.data as { id: string };
        onCreated({ id, ownerId: userId, hours: nextHours, workDate: nextDate, note: nextNote });
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
          {t("time_entries.hours")} <span aria-hidden="true" className="text-danger">*</span>
        </span>
        <input
          className={hoursError ? `${inputClass} ${invalidRing}` : inputClass}
          type="number"
          inputMode="decimal"
          min="0"
          max="24"
          step="0.25"
          dir="ltr"
          value={hours}
          placeholder={t("time_entries.hoursPlaceholder")}
          onChange={(e) => {
            setHours(e.target.value);
            if (hoursError) setHoursError(null);
          }}
          aria-required="true"
          aria-invalid={hoursError !== null}
        />
        {hoursError ? (
          <span role="alert" className="type-caption text-danger">
            {t(hoursError === "required" ? "time_entries.fieldRequired" : "time_entries.hoursInvalid")}
          </span>
        ) : null}
      </label>
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("time_entries.workDate")}
        <input
          className={inputClass}
          type="date"
          value={workDate}
          onChange={(e) => setWorkDate(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("time_entries.note")}
        <textarea
          className={`${inputClass} min-h-24 resize-y`}
          value={note}
          placeholder={t("time_entries.notePlaceholder")}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-app-teal py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
      >
        {t("time_entries.add")}
      </button>
    </form>
  );
}

function EditEntryForm({
  entry,
  onSave,
  onCancel,
}: {
  entry: TimeEntry;
  onSave: (next: EntryDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  // Seed the hours input from the stored number (as a string for the input value).
  const [hours, setHours] = useState(String(entry.hours));
  const [workDate, setWorkDate] = useState(entry.workDate);
  const [note, setNote] = useState(entry.note);
  const [hoursError, setHoursError] = useState<"required" | "range" | null>(null);
  // True while a save is in flight. Disables submit and makes a second submit a
  // no-op (the parent's saveEntry also guards per-id — belt-and-suspenders).
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

    const err = hoursErrorOf(hours);
    setHoursError(err);
    if (err) return;
    const nextHours = Number(hours.trim());

    const nextDate = workDate.trim() === "" ? todayInput() : workDate;
    const nextNote = note.trim();

    setSubmitting(true);
    try {
      await onSave({ hours: nextHours, workDate: nextDate, note: nextNote });
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-sm rounded-lg bg-card p-md">
      <label className="flex flex-col gap-2xs type-label text-muted">
        <span>
          {t("time_entries.hours")} <span aria-hidden="true" className="text-danger">*</span>
        </span>
        <input
          className={hoursError ? `${inputClass} ${invalidRing}` : inputClass}
          type="number"
          inputMode="decimal"
          min="0"
          max="24"
          step="0.25"
          dir="ltr"
          value={hours}
          placeholder={t("time_entries.hoursPlaceholder")}
          onChange={(e) => {
            setHours(e.target.value);
            if (hoursError) setHoursError(null);
          }}
          aria-required="true"
          aria-invalid={hoursError !== null}
        />
        {hoursError ? (
          <span role="alert" className="type-caption text-danger">
            {t(hoursError === "required" ? "time_entries.fieldRequired" : "time_entries.hoursInvalid")}
          </span>
        ) : null}
      </label>
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("time_entries.workDate")}
        <input
          className={inputClass}
          type="date"
          value={workDate}
          onChange={(e) => setWorkDate(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("time_entries.note")}
        <textarea
          className={`${inputClass} min-h-24 resize-y`}
          value={note}
          placeholder={t("time_entries.notePlaceholder")}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="flex items-center gap-sm">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-md bg-app-teal py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
        >
          {t("time_entries.save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-md bg-hairline px-md py-sm type-label text-ink interactive motion-safe:active:scale-[0.97]"
        >
          {t("time_entries.cancel")}
        </button>
      </div>
    </form>
  );
}

/**
 * ADMIN-ONLY team overview (read-only). Reuses the SAME cache entries — an admin's
 * query already returns everyone's rows via the tree-admin read path, so there is
 * NO new query — grouped by `ownerId`. Names resolve through `useStaffMembers`
 * (displayName ?? email); an unknown owner falls back to a dash. No add/edit/delete
 * here: those stay in the "my entries" view. RLS is the boundary; this is
 * presentation only. RTL-first, design tokens only, like the rest of the file.
 */
function TeamView({ entries }: { entries: TimeEntry[] }) {
  const { t } = useI18n();
  const { members } = useStaffMembers();
  // userId -> display name (displayName preferred, email as the fallback label).
  const nameById = new Map(
    members.map((m): [string, string] => [m.userId, m.displayName ?? m.email]),
  );

  // Group by owner, PRESERVING the source order (the list is pre-sorted newest-first
  // by work_date), so each employee's entries stay newest-first with no re-sort.
  const groups = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.ownerId) ?? [];
    list.push(entry);
    groups.set(entry.ownerId, list);
  }
  // One row per employee, sorted by resolved name. Round the total so float addition
  // (e.g. 0.25 steps) never shows a drifting tail.
  const employees = [...groups.entries()]
    .map(([ownerId, list]) => ({
      ownerId,
      name: nameById.get(ownerId) ?? "—",
      list,
      totalHours: Math.round(list.reduce((sum, e) => sum + e.hours, 0) * 100) / 100,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-md">
      {/* A small, plain link to add an employee — the staff tool owns that flow. */}
      <Link
        href="/tools/staff"
        className="self-start type-label text-app-teal interactive motion-safe:active:scale-[0.99]"
      >
        {t("time_entries.addEmployee")}
      </Link>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-xs rounded-lg bg-card px-lg py-2xl text-center">
          <p className="type-heading text-ink">{t("time_entries.teamEmptyTitle")}</p>
          <p className="max-w-[24ch] type-label text-muted">{t("time_entries.teamEmptyHint")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-md">
          {employees.map((emp) => (
            <section key={emp.ownerId} className="flex flex-col gap-sm rounded-lg bg-card p-md">
              {/* Employee header: name at the start; total hours + entry count at the end. */}
              <div className="flex items-start justify-between gap-sm">
                <span className="min-w-0 truncate type-heading text-ink">{emp.name}</span>
                <div className="flex shrink-0 flex-col items-end gap-2xs text-end">
                  <span className="type-caption text-muted">{t("time_entries.totalHours")}</span>
                  <span dir="ltr" className="type-heading text-app-teal">
                    {emp.totalHours} {t("time_entries.hoursUnit")}
                  </span>
                  <span className="type-caption text-muted">
                    {emp.list.length} {t("time_entries.entryCount")}
                  </span>
                </div>
              </div>

              <ul className="flex flex-col divide-y divide-hairline">
                {emp.list.map((entry) => (
                  <li key={entry.id} className="flex flex-col gap-2xs py-sm">
                    <span className="flex w-full items-center justify-between gap-sm">
                      <span className="truncate type-body text-ink" dir="ltr">
                        {entry.hours} {t("time_entries.hoursUnit")}
                      </span>
                      <span className="shrink-0 type-label text-muted" dir="ltr">
                        {entry.workDate}
                      </span>
                    </span>
                    {entry.note ? (
                      <span className="w-full truncate type-label text-muted">{entry.note}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
