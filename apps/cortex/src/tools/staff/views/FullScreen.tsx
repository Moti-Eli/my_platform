"use client";

/**
 * Staff full screen (Standard §2 `views/FullScreen.tsx`, §8). Cloned from Tasks'
 * full screen, on the app-teal identity accent. The member list plus ONE write:
 * an admin can switch a member between Member and Admin.
 *
 * The read is the SHARED react-query cache (`useStaffMembers`, queryKey
 * ["staff","members"]) — the same entry the dashboard card reads. The role write is
 * OPTIMISTIC (flip in the cache, reconcile on success, revert on failure), mirroring
 * the tasks toggle. All calls go through the SERVER action (`runIntentAction`),
 * which builds ctx from the session, so no identity is sent from here.
 *
 * This route is ADMIN-ONLY (manifest `requiresAdmin`); the page above re-checks
 * isAdmin server-side and redirects a non-admin before this ever renders. And the
 * role write itself is gated at the DB: `membership_roles`' triggers refuse a
 * non-admin's write and refuse demoting the org's last admin. This screen does NOT
 * pre-check either — it attempts the write and surfaces the DB's error.
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
import { useStaffMembers, STAFF_MEMBERS_KEY } from "@/lib/query/useStaffMembers";
import type { Member } from "../logic";

/** The failure codes a write can come back with (from {@link IntentResult}). */
type WriteErrorCode = Extract<IntentResult, { ok: false }>["code"];

/** Muted placeholder block for the loading skeleton. */
const SKELETON = "rounded-md bg-hairline motion-safe:animate-pulse";

/** A member's display name, falling back to the email's local part when unset. */
function memberName(m: Member): string {
  return m.displayName ?? m.email.split("@")[0] ?? "";
}

// userId/orgId arrive as props (the page called requireSession()) but are NOT sent
// to the action — the server derives identity from the session cookie. `_props`
// marks them deliberately unused.
export function FullScreen(_props: ToolViewProps) {
  const { t, dir } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { members, isLoading, isError } = useStaffMembers();

  // Set when a role write actually FAILS — a demote-last-admin or non-admin attempt
  // (both refused by the DB triggers) lands here. Never a silent no-op.
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);

  // Guards the async setState in the write callback: it resolves after an await, so
  // a navigation away before it settles must not set component state on an unmounted
  // component. (Cache writes via queryClient are safe either way.)
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // In-flight role changes, keyed by membershipId (mirrors tasks' per-row guard). A
  // second toggle for a member whose write is still running is ignored, and that
  // row's control is disabled, so a double-tap can't double-apply.
  const pendingRef = useRef<Set<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(pendingRef.current);

  // --- Add-member form (additive, top of screen) -----------------------------
  // Its error state is SEPARATE from `writeError` so an add failure and a role
  // failure never clobber each other's alert.
  const [formOpen, setFormOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [addError, setAddError] = useState<WriteErrorCode | null>(null);
  const [addedOk, setAddedOk] = useState(false);

  const fieldClass =
    "min-h-11 w-full rounded-md bg-card px-sm py-xs type-body text-ink outline-none placeholder:text-muted interactive";

  // Patch one member in the shared cache by membershipId. Functional updater, so
  // concurrent in-flight writes compose instead of clobbering. `prev ?? []` because
  // the cache can momentarily be undefined.
  const patchMember = useCallback(
    (membershipId: string, patch: (m: Member) => Member) => {
      queryClient.setQueryData<Member[]>(STAFF_MEMBERS_KEY, (prev) =>
        (prev ?? []).map((m) => (m.membershipId === membershipId ? patch(m) : m)),
      );
    },
    [queryClient],
  );

  const setRole = useCallback(
    async (membershipId: string, targetRole: "admin" | "member") => {
      // 0. GUARD double-submit: ignore a toggle whose write is still in flight.
      if (pendingRef.current.has(membershipId)) return;
      const nextPending = new Set(pendingRef.current).add(membershipId);
      pendingRef.current = nextPending;
      setPending(nextPending);

      const nextIsAdmin = targetRole === "admin";
      // 1. OPTIMISTIC: flip isAdmin straight into the SHARED cache.
      setWriteError(null);
      patchMember(membershipId, (m) => ({ ...m, isAdmin: nextIsAdmin }));

      try {
        const res = await runIntentAction("staff.set_member_role", { membershipId, targetRole });
        if (res.ok) {
          // 2. Reconcile to the server's AUTHORITATIVE isAdmin.
          const { membershipId: rid, isAdmin } = res.data as {
            membershipId: string;
            isAdmin: boolean;
          };
          patchMember(rid, (m) => ({ ...m, isAdmin }));
        } else {
          // 3. REVERT to the prior value and surface the error. A demote of the last
          //    admin, or a non-admin attempt, is refused by the DB and lands here.
          patchMember(membershipId, (m) => ({ ...m, isAdmin: !nextIsAdmin }));
          if (mounted.current) setWriteError(res.code);
        }
      } finally {
        const cleared = new Set(pendingRef.current);
        cleared.delete(membershipId);
        pendingRef.current = cleared;
        if (mounted.current) setPending(cleared);
      }
    },
    [patchMember],
  );

  const addMember = useCallback(async () => {
    // GUARD double-submit: the button is disabled while submitting, this is belt-
    // and-suspenders. `submitting` is in deps so the closure reads a fresh value.
    if (submitting) return;
    setSubmitting(true);
    setAddError(null);
    setAddedOk(false);
    try {
      const res = await runIntentAction("staff.add_member", {
        email: newEmail,
        displayName: newDisplayName,
      });
      if (res.ok) {
        // Clear + close, then refresh the SHARED cache so the new member loads.
        setNewEmail("");
        setNewDisplayName("");
        setFormOpen(false);
        await queryClient.invalidateQueries({ queryKey: STAFF_MEMBERS_KEY });
        if (mounted.current) setAddedOk(true);
      } else if (mounted.current) {
        setAddError(res.code);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }, [submitting, newEmail, newDisplayName, queryClient]);

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
        <h1 className="flex-1 type-title text-ink">{t("staff.name")}</h1>
      </div>

      {/* Add-member: a toggle that reveals an inline form. Additive to the top of
          the screen; the list and role toggle below are unchanged. */}
      <div className="flex flex-col gap-xs">
        <button
          type="button"
          onClick={() => {
            setAddError(null);
            setAddedOk(false);
            setFormOpen((o) => !o);
          }}
          className="self-start rounded-md bg-card px-sm py-xs type-label text-ink interactive motion-safe:active:scale-[0.97]"
        >
          {t("staff.addMember")}
        </button>

        {formOpen ? (
          <div className="flex flex-col gap-xs">
            <label className="flex flex-col gap-2xs">
              <span className="type-label text-muted">{t("staff.addMemberEmail")}</span>
              <input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                type="email"
                autoComplete="email"
                dir="ltr"
                className={`${fieldClass} text-start`}
              />
            </label>

            <label className="flex flex-col gap-2xs">
              <span className="type-label text-muted">{t("staff.addMemberName")}</span>
              <input
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                type="text"
                autoComplete="name"
                className={fieldClass}
              />
            </label>

            {addError ? (
              <p
                role="alert"
                className="flex items-start gap-xs rounded-md bg-danger/10 px-sm py-xs type-label text-danger"
              >
                <InfoIcon width={18} height={18} aria-hidden className="mt-2xs shrink-0" />
                <span>
                  {addError === "emailExists"
                    ? t("staff.addMemberEmailExists")
                    : t("staff.addMemberFailed")}
                </span>
              </p>
            ) : null}

            <button
              type="button"
              onClick={addMember}
              disabled={submitting}
              className="self-start rounded-md bg-accent/15 px-sm py-xs type-label text-accent interactive motion-safe:active:scale-[0.97]"
            >
              {submitting ? t("staff.addMemberSubmitting") : t("staff.addMemberSubmit")}
            </button>
          </div>
        ) : null}

        {addedOk ? (
          <p role="status" className="type-label text-muted">
            {t("staff.addMemberSuccess")}
          </p>
        ) : null}
      </div>

      {writeError ? (
        <p
          role="alert"
          className="flex items-start gap-xs rounded-md bg-danger/10 px-sm py-xs type-label text-danger"
        >
          <InfoIcon width={18} height={18} aria-hidden className="mt-2xs shrink-0" />
          <span>{t("staff.roleChangeFailed")}</span>
        </p>
      ) : null}

      {isLoading ? (
        <ul className="flex flex-col divide-y divide-hairline" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="flex items-center justify-between gap-sm py-sm">
              <span className="flex min-w-0 flex-col gap-2xs">
                <span className={`h-4 w-32 ${SKELETON}`} />
                <span className={`h-3 w-40 ${SKELETON}`} />
              </span>
              <span className={`h-5 w-16 rounded-pill ${SKELETON}`} />
            </li>
          ))}
        </ul>
      ) : isError ? (
        <p className="type-label text-muted">{t("staff.loadFailed")}</p>
      ) : members.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-xs rounded-lg bg-card px-lg py-2xl text-center">
          <p className="type-heading text-ink">{t("staff.emptyTitle")}</p>
          <p className="max-w-[24ch] type-label text-muted">{t("staff.emptyHint")}</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {members.map((m) => {
            // This row has a role write in flight — disable its toggle so a second
            // tap can't double-apply. Other rows are unaffected.
            const rowPending = pending.has(m.membershipId);
            return (
              <li key={m.membershipId} className="flex items-center justify-between gap-sm py-sm">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate type-heading text-ink">{memberName(m)}</span>
                  <span className="truncate type-label text-muted" dir="ltr">
                    {m.email}
                  </span>
                </div>
                {/* The role pill IS the toggle — a single tap flips Member↔Admin (no
                    confirm; it's reversible). aria-label names the ACTION; the label
                    shows the current role. Reuses the profile role-pill style. */}
                <button
                  type="button"
                  onClick={() => setRole(m.membershipId, m.isAdmin ? "member" : "admin")}
                  disabled={rowPending}
                  aria-label={m.isAdmin ? t("staff.makeMember") : t("staff.makeAdmin")}
                  className={`shrink-0 rounded-pill px-sm py-2xs type-caption interactive motion-safe:active:scale-[0.97] ${
                    m.isAdmin ? "bg-accent/15 text-accent" : "bg-hairline text-muted"
                  }`}
                >
                  {m.isAdmin ? t("staff.roleAdmin") : t("staff.roleMember")}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
