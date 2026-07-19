"use client";

/**
 * Notes full screen (Standard §2 `views/FullScreen.tsx`, §8). Cloned from Tasks'
 * full screen, on the app-coral identity accent.
 *
 * Note list with an add action, an inline per-row EDIT (title + body), and a
 * per-row delete. The read is the SHARED react-query cache (`useNotesList`,
 * queryKey ["notes","list"]) — the same entry the dashboard card reads — so this
 * screen renders from cache and each write reconciles that cache via setQueryData
 * (no refetch). Writes go straight through the SERVER action (`runIntentAction`);
 * every call — read or write — builds ctx from the session, so no identity is sent
 * from here.
 *
 * WRITES WORK (20260717000009 opened the path, mirroring tasks). A write flows
 * runIntentAction -> the server data-layer -> the RLS client, gated ROW BY ROW by
 * `private.auth_user_can_write`: membership in the row's org tree is the gate. A
 * write can genuinely succeed — so this screen edits/deletes OPTIMISTICALLY and
 * reconciles to the server's authoritative answer — or genuinely fail, in which
 * case the failure is surfaced honestly, never faked and never swallowed.
 *
 * THE ONE SHAPE DIFFERENCE FROM TASKS: a note has an editable `body`, so a row is
 * not a boolean toggle but an inline edit (title + body) firing `notes.update_note`.
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
import type { Note } from "../logic";
import { useNotesList, NOTES_LIST_KEY } from "@/lib/query/useNotesList";

/** The failure codes a write can come back with (from {@link IntentResult}). */
type WriteErrorCode = Extract<IntentResult, { ok: false }>["code"];

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
  const { notes } = useNotesList();
  const [adding, setAdding] = useState(false);
  // Which note is being edited inline (null = none). Only one row edits at a time.
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

  // In-flight EDITS, keyed by note id. A second save for a note whose write is
  // still running is ignored, so a double-tap can't double-apply. This is PER-NOTE,
  // not a global lock. The ref is the synchronous source of truth for the guard
  // (reading `saving` state would be stale within a burst of taps).
  const savingRef = useRef<Set<string>>(new Set());

  // In-flight DELETES, keyed by note id — a SEPARATE guard from the edit set above,
  // so an edit and a delete never share a lock. Mirrors tasks' `deleting`.
  const deletingRef = useRef<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(deletingRef.current);
  // Which row is mid two-tap delete confirm (null = none). Tapping a different row's
  // trash moves the confirm there; a second tap on the SAME row commits the delete.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Patch one row in the shared cache by id. Functional updater, so concurrent
  // in-flight writes compose instead of clobbering. `prev ?? []` because the cache
  // can momentarily be undefined (a write racing ahead of the first read).
  const patchNote = useCallback(
    (id: string, patch: (it: Note) => Note) => {
      queryClient.setQueryData<Note[]>(NOTES_LIST_KEY, (prev) =>
        (prev ?? []).map((it) => (it.id === id ? patch(it) : it)),
      );
    },
    [queryClient],
  );

  const saveNote = useCallback(
    async (id: string, next: { title: string; body: string }) => {
      // 0. GUARD double-submit: ignore a save for a note whose write is still in
      //    flight. The ref check is synchronous, so it catches a second tap in the
      //    micro-window before the disabled button re-renders.
      if (savingRef.current.has(id)) return;

      // Snapshot the row BEFORE editing, so a failure can restore it exactly.
      const prevList = queryClient.getQueryData<Note[]>(NOTES_LIST_KEY) ?? [];
      const prev = prevList.find((it) => it.id === id) ?? null;

      savingRef.current = new Set(savingRef.current).add(id);

      // 1. OPTIMISTIC: write the new title/body straight into the SHARED cache,
      //    before awaiting, so the edit has instant feedback AND the dashboard card
      //    (reading the same cache) moves in lockstep.
      setWriteError(null);
      patchNote(id, (it) => ({ ...it, title: next.title, body: next.body }));

      try {
        const res = await runIntentAction("notes.update_note", {
          id,
          title: next.title,
          body: next.body,
        });

        if (res.ok) {
          // 2. Success: close the inline editor. Nothing to reconcile — the cache
          //    already holds exactly what we submitted, which is authoritative.
          if (mounted.current) setEditingId((cur) => (cur === id ? null : cur));
        } else {
          // 3. REVERT to the snapshot and surface the real error; leave the editor
          //    open so the edit isn't lost. The cache is written only on these
          //    chosen paths, so a failure leaves it consistent — never corrupted.
          if (prev) patchNote(id, () => prev);
          if (mounted.current) setWriteError(res.code);
        }
      } finally {
        // Clear the in-flight mark whether the write succeeded, failed, or threw.
        const cleared = new Set(savingRef.current);
        cleared.delete(id);
        savingRef.current = cleared;
      }
    },
    [patchNote, queryClient],
  );

  const removeNote = useCallback(
    async (id: string) => {
      // 0. GUARD double-delete (mirrors saveNote's in-flight guard): ignore a
      //    delete for a note whose delete is already running.
      if (deletingRef.current.has(id)) return;

      // Snapshot the row AND its index from the cache BEFORE removing, so a failure
      // can restore it exactly where it was.
      const prevList = queryClient.getQueryData<Note[]>(NOTES_LIST_KEY) ?? [];
      const index = prevList.findIndex((it) => it.id === id);
      const removed = index >= 0 ? prevList[index] : null;

      const nextDeleting = new Set(deletingRef.current).add(id);
      deletingRef.current = nextDeleting;
      setDeleting(nextDeleting);

      // 1. OPTIMISTIC: drop the row from the SHARED cache immediately, so the
      //    dashboard card (reading the same cache) drops it in lockstep.
      setWriteError(null);
      queryClient.setQueryData<Note[]>(NOTES_LIST_KEY, (prev) =>
        (prev ?? []).filter((it) => it.id !== id),
      );

      try {
        const res = await runIntentAction("notes.delete_note", { id });
        // 2. On success: leave it removed — nothing to reconcile.
        if (!res.ok) {
          // 3. REVERT: re-insert the removed row at its original position and
          //    surface the error via the existing writeError alert. The cache is
          //    written only on these chosen paths, so a failure leaves it consistent.
          if (removed) {
            queryClient.setQueryData<Note[]>(NOTES_LIST_KEY, (prev) => {
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
        <h1 className="flex-1 type-title text-ink">{t("notes.name")}</h1>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-pill bg-app-coral px-md py-xs type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
        >
          {t("notes.addNote")}
        </button>
      </div>

      {writeError ? (
        <p
          role="alert"
          className="flex items-start gap-xs rounded-md bg-danger/10 px-sm py-xs type-label text-danger"
        >
          <InfoIcon width={18} height={18} aria-hidden className="mt-2xs shrink-0" />
          <span>
            {t(writeError === "failed" ? "notes.errorFailed" : "notes.errorDenied")}
          </span>
        </p>
      ) : null}

      {adding ? (
        <AddNoteForm
          onCreated={(note) => {
            // create_note returns { id }; the rest of the row is exactly what we
            // submitted, so append it straight into the SHARED cache — no refetch,
            // and the dashboard card sees the new note immediately.
            queryClient.setQueryData<Note[]>(NOTES_LIST_KEY, (prev) => [...(prev ?? []), note]);
            setAdding(false);
            setWriteError(null);
          }}
          onError={(code) => setWriteError(code)}
        />
      ) : null}

      {notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-xs rounded-lg bg-card px-lg py-2xl text-center">
          <p className="type-heading text-ink">{t("notes.emptyTitle")}</p>
          <p className="max-w-[24ch] type-label text-muted">{t("notes.emptyHint")}</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {notes.map((note) => {
            const rowDeleting = deleting.has(note.id);
            const confirming = confirmId === note.id;

            // Editing: the whole row becomes an inline edit form (title + body).
            if (editingId === note.id) {
              return (
                <li key={note.id} className="py-sm">
                  <EditNoteForm
                    note={note}
                    onSave={(next) => saveNote(note.id, next)}
                    onCancel={() => setEditingId(null)}
                  />
                </li>
              );
            }

            return (
              <li key={note.id} className="flex items-center gap-sm py-sm">
                <button
                  type="button"
                  aria-label={t("notes.editNote")}
                  onClick={() => {
                    setConfirmId(null);
                    setEditingId(note.id);
                  }}
                  disabled={rowDeleting}
                  className="flex min-w-0 flex-1 flex-col items-start gap-2xs text-start interactive motion-safe:active:scale-[0.99]"
                >
                  <span className="w-full truncate type-heading text-ink">{note.title}</span>
                  {note.body ? (
                    <span className="w-full truncate type-label text-muted">{note.body}</span>
                  ) : null}
                </button>

                {/* Delete — a two-tap inline confirm (no modal, no window.confirm):
                    first tap arms "Delete?", a second tap commits. Tapping another
                    row's trash moves the confirm there. */}
                {confirming ? (
                  <button
                    type="button"
                    aria-label={t("notes.confirmDelete")}
                    onClick={() => {
                      setConfirmId(null);
                      void removeNote(note.id);
                    }}
                    disabled={rowDeleting}
                    className="shrink-0 rounded-pill bg-danger px-sm py-2xs type-caption text-on-fill interactive motion-safe:active:scale-[0.97]"
                  >
                    {t("notes.confirmDelete")}
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={t("notes.delete")}
                    onClick={() => setConfirmId(note.id)}
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

function AddNoteForm({
  onCreated,
  onError,
}: {
  onCreated: (note: Note) => void;
  onError: (code: WriteErrorCode) => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  // Whether the required title is blank-on-submit. Drives the marking + message;
  // cleared as soon as the user edits it.
  const [invalid, setInvalid] = useState<{ title: boolean }>({ title: false });
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

    const nextTitle = title.trim();

    // Required-field validation is VISIBLE now — a blank title marks itself and
    // says what is missing, instead of the submit silently doing nothing.
    const nextInvalid = { title: nextTitle === "" };
    setInvalid(nextInvalid);
    if (nextInvalid.title) return;

    // body is optional; an empty input is a real "no body" (stored as '').
    const nextBody = body.trim();

    // Lock only AFTER validation passes, so a failed validation leaves the button
    // usable. Released in `finally`, whatever the outcome.
    setSubmitting(true);
    try {
      // No ctx argument — the server builds it from the session.
      const res = await runIntentAction("notes.create_note", {
        title: nextTitle,
        body: nextBody === "" ? undefined : nextBody,
      });
      if (!mounted.current) return;

      if (res.ok) {
        // create_note returns only { id }; the rest of the Note is the values we
        // just submitted, so we can hand a complete row up to append.
        const { id } = res.data as { id: string };
        onCreated({ id, title: nextTitle, body: nextBody });
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
          {t("notes.noteTitle")} <span aria-hidden="true" className="text-danger">*</span>
        </span>
        <input
          className={invalid.title ? `${inputClass} ${invalidRing}` : inputClass}
          value={title}
          placeholder={t("notes.titlePlaceholder")}
          onChange={(e) => {
            setTitle(e.target.value);
            if (invalid.title) setInvalid((v) => ({ ...v, title: false }));
          }}
          aria-required="true"
          aria-invalid={invalid.title}
        />
        {invalid.title ? (
          <span role="alert" className="type-caption text-danger">
            {t("notes.fieldRequired")}
          </span>
        ) : null}
      </label>
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("notes.noteBody")}
        <textarea
          className={`${inputClass} min-h-24 resize-y`}
          value={body}
          placeholder={t("notes.bodyPlaceholder")}
          rows={3}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-app-coral py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
      >
        {t("notes.add")}
      </button>
    </form>
  );
}

function EditNoteForm({
  note,
  onSave,
  onCancel,
}: {
  note: Note;
  onSave: (next: { title: string; body: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [invalid, setInvalid] = useState<{ title: boolean }>({ title: false });
  // True while a save is in flight. Disables submit and makes a second submit a
  // no-op (the parent's saveNote also guards per-id — belt-and-suspenders).
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

    const nextTitle = title.trim();
    const nextInvalid = { title: nextTitle === "" };
    setInvalid(nextInvalid);
    if (nextInvalid.title) return;

    const nextBody = body.trim();

    setSubmitting(true);
    try {
      await onSave({ title: nextTitle, body: nextBody });
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-sm rounded-lg bg-card p-md">
      <label className="flex flex-col gap-2xs type-label text-muted">
        <span>
          {t("notes.noteTitle")} <span aria-hidden="true" className="text-danger">*</span>
        </span>
        <input
          className={invalid.title ? `${inputClass} ${invalidRing}` : inputClass}
          value={title}
          placeholder={t("notes.titlePlaceholder")}
          onChange={(e) => {
            setTitle(e.target.value);
            if (invalid.title) setInvalid((v) => ({ ...v, title: false }));
          }}
          aria-required="true"
          aria-invalid={invalid.title}
        />
        {invalid.title ? (
          <span role="alert" className="type-caption text-danger">
            {t("notes.fieldRequired")}
          </span>
        ) : null}
      </label>
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("notes.noteBody")}
        <textarea
          className={`${inputClass} min-h-24 resize-y`}
          value={body}
          placeholder={t("notes.bodyPlaceholder")}
          rows={3}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <div className="flex items-center gap-sm">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-md bg-app-coral py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
        >
          {t("notes.save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-md bg-hairline px-md py-sm type-label text-ink interactive motion-safe:active:scale-[0.97]"
        >
          {t("notes.cancel")}
        </button>
      </div>
    </form>
  );
}
