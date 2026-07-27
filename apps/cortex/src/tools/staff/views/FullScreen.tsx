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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { ToolCategory } from "@platform/cortex-core";
import { runIntentAction, type IntentResult } from "@/cortex/actions";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { ChevronIcon, ChevronDownIcon, InfoIcon, LockIcon } from "@/components/icons";
import { useRegisteredApps } from "@/cortex/apps";
import { useStaffMembers, STAFF_MEMBERS_KEY } from "@/lib/query/useStaffMembers";
import { useStaffRoles } from "@/lib/query/useStaffRoles";
import type { Member, RoleWithPermissions } from "../logic";

/** The failure codes a write can come back with (from {@link IntentResult}). */
type WriteErrorCode = Extract<IntentResult, { ok: false }>["code"];

/** Muted placeholder block for the loading skeleton. */
const SKELETON = "rounded-md bg-hairline motion-safe:animate-pulse";

/** A member's display name, falling back to the email's local part when unset. */
function memberName(m: Member): string {
  return m.displayName ?? m.email.split("@")[0] ?? "";
}

/** Category group order for a role's permission keys — the ToolCategory order, then
 * the "platform" fallback last. Deterministic so a role's groups never reshuffle. */
const CATEGORY_ORDER: readonly ToolCategory[] = [
  "people",
  "productivity",
  "finance",
  "operations",
  "personal",
];

/** A permission key's group: derive the tool id (the part before the dot) and read
 * THAT tool's manifest category; a key whose prefix matches no registered tool
 * (e.g. "members.manage") falls back to the "platform" group. */
function useCategoryOfKey(): (key: string) => ToolCategory | "platform" {
  const apps = useRegisteredApps();
  const categoryById = useMemo(() => {
    const m = new Map<string, ToolCategory>();
    for (const a of apps) m.set(a.id, a.category);
    return m;
  }, [apps]);
  return useCallback(
    (key: string): ToolCategory | "platform" => {
      const toolId = key.split(".")[0] ?? "";
      return categoryById.get(toolId) ?? "platform";
    },
    [categoryById],
  );
}

/** The expanded body of a non-admin role: its permission keys grouped by the
 * owning tool's category (platform keys last), read-only. */
function RolePermissionGroups({
  keys,
  categoryOf,
}: {
  keys: string[];
  categoryOf: (key: string) => ToolCategory | "platform";
}) {
  const { t } = useI18n();
  // Bucket keys by category, then render buckets in the fixed order.
  const grouped = useMemo(() => {
    const m = new Map<ToolCategory | "platform", string[]>();
    for (const k of keys) {
      const c = categoryOf(k);
      const list = m.get(c) ?? [];
      list.push(k);
      m.set(c, list);
    }
    return m;
  }, [keys, categoryOf]);

  const order: (ToolCategory | "platform")[] = [...CATEGORY_ORDER, "platform"];

  return (
    <div className="flex flex-col gap-sm pt-xs">
      {order.map((group) => {
        const groupKeys = grouped.get(group);
        if (!groupKeys || groupKeys.length === 0) return null;
        const label =
          group === "platform" ? t("staff.permGroupPlatform") : t(`categories.${group}`);
        return (
          <div key={group} className="flex flex-col gap-2xs">
            <span className="type-caption text-muted">{label}</span>
            <div className="flex flex-wrap gap-2xs">
              {groupKeys.map((k) => (
                <span
                  key={k}
                  dir="ltr"
                  className="rounded-md bg-screen px-xs py-2xs type-caption text-ink"
                >
                  {k}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The read-only roles section shown above the members list: every role with its
 * holder + permission counts; admin roles carry a lock badge and "all permissions";
 * non-admin roles expand to their permission keys grouped by tool category. */
function RolesSection() {
  const { t } = useI18n();
  const { roles, memberRoles, isLoading, isError } = useStaffRoles();
  const categoryOf = useCategoryOfKey();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  // Holder count per role, from the membership_roles edges.
  const holdersByRole = useMemo(() => {
    const m = new Map<string, number>();
    for (const mr of memberRoles) m.set(mr.roleId, (m.get(mr.roleId) ?? 0) + 1);
    return m;
  }, [memberRoles]);

  // Admin roles first, then alphabetical — a stable, readable order.
  const orderedRoles = useMemo(
    () =>
      [...roles].sort(
        (a, b) => Number(b.isAdmin) - Number(a.isAdmin) || a.name.localeCompare(b.name),
      ),
    [roles],
  );

  const toggle = useCallback((roleId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  }, []);

  const countsLine = (role: RoleWithPermissions): string => {
    const holders = t("staff.roleHolders").replace("{count}", String(holdersByRole.get(role.id) ?? 0));
    const perms = role.isAdmin
      ? t("staff.allPermissions")
      : t("staff.rolePermissions").replace("{count}", String(role.permissionKeys.length));
    return `${holders} · ${perms}`;
  };

  return (
    <section className="flex flex-col gap-xs">
      <h2 className="type-label text-muted">{t("staff.rolesTitle")}</h2>

      {isLoading ? (
        <ul className="flex flex-col divide-y divide-hairline" aria-hidden="true">
          {[0, 1].map((i) => (
            <li key={i} className="flex items-center justify-between gap-sm py-sm">
              <span className={`h-4 w-28 ${SKELETON}`} />
              <span className={`h-3 w-24 ${SKELETON}`} />
            </li>
          ))}
        </ul>
      ) : isError ? (
        <p className="type-label text-muted">{t("staff.rolesLoadFailed")}</p>
      ) : orderedRoles.length === 0 ? (
        <p className="type-label text-muted">{t("staff.rolesEmpty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {orderedRoles.map((role) => {
            const isOpen = expanded.has(role.id);
            const rowInner = (
              <>
                <span className="flex min-w-0 items-center gap-xs">
                  {role.isAdmin ? (
                    <LockIcon
                      width={16}
                      height={16}
                      aria-label={t("staff.roleAdminBadge")}
                      className="shrink-0 text-accent"
                    />
                  ) : null}
                  <span className="truncate type-heading text-ink">{role.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-xs">
                  <span className="type-caption text-muted">{countsLine(role)}</span>
                  {role.isAdmin ? null : (
                    <ChevronDownIcon
                      width={18}
                      height={18}
                      aria-hidden
                      className="text-muted motion-safe:transition-transform"
                      style={{ transform: isOpen ? "rotate(180deg)" : undefined }}
                    />
                  )}
                </span>
              </>
            );

            return (
              <li key={role.id} className="py-sm">
                {role.isAdmin ? (
                  // Admin roles are not expandable — they hold everything; there is
                  // no key list to show.
                  <div className="flex items-center justify-between gap-sm">{rowInner}</div>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggle(role.id)}
                    aria-expanded={isOpen}
                    aria-label={isOpen ? t("staff.rolePermsCollapse") : t("staff.rolePermsExpand")}
                    className="flex w-full items-center justify-between gap-sm text-start interactive"
                  >
                    {rowInner}
                  </button>
                )}

                {!role.isAdmin && isOpen ? (
                  role.permissionKeys.length > 0 ? (
                    <RolePermissionGroups keys={role.permissionKeys} categoryOf={categoryOf} />
                  ) : (
                    <p className="pt-xs type-caption text-muted">
                      {t("staff.rolePermissions").replace("{count}", "0")}
                    </p>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// userId/orgId arrive as props (the page called requireSession()) but are NOT sent
// to the action — the server derives identity from the session cookie. `_props`
// marks them deliberately unused.
export function FullScreen(_props: ToolViewProps) {
  const { t, dir } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { members, isLoading, isError } = useStaffMembers();
  // Shared cache with RolesSection (same query key) — used here only to render each
  // member's role chips from the membership_roles edges. Read-only.
  const { roles: allRoles, memberRoles } = useStaffRoles();

  // membershipId -> the roles that membership holds (id + display name), so a row
  // can show real role chips instead of the binary Admin/Member label.
  const rolesByMembership = useMemo(() => {
    const nameById = new Map(allRoles.map((r) => [r.id, r.name]));
    const m = new Map<string, { id: string; name: string }[]>();
    for (const mr of memberRoles) {
      const name = nameById.get(mr.roleId);
      if (name === undefined) continue;
      const list = m.get(mr.membershipId) ?? [];
      list.push({ id: mr.roleId, name });
      m.set(mr.membershipId, list);
    }
    return m;
  }, [allRoles, memberRoles]);

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
                    : addError === "alreadyMember"
                      ? t("staff.addMemberAlreadyMember")
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

      {/* Read-only roles section — above the members list, per the mockup. */}
      <RolesSection />

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
                <div className="flex min-w-0 flex-col gap-2xs">
                  <span className="truncate type-heading text-ink">{memberName(m)}</span>
                  <span className="truncate type-label text-muted" dir="ltr">
                    {m.email}
                  </span>
                  {/* Role chips from membership_roles. A member holding no role row
                      keeps the default Member label. The toggle pill (right) is
                      unchanged — it remains the admin's Member↔Admin control. */}
                  <div className="flex flex-wrap gap-2xs pt-2xs">
                    {(rolesByMembership.get(m.membershipId) ?? []).length > 0 ? (
                      (rolesByMembership.get(m.membershipId) ?? []).map((r) => (
                        <span
                          key={r.id}
                          className="rounded-pill bg-hairline px-xs py-2xs type-caption text-muted"
                        >
                          {r.name}
                        </span>
                      ))
                    ) : (
                      <span className="rounded-pill bg-hairline px-xs py-2xs type-caption text-muted">
                        {t("staff.roleMember")}
                      </span>
                    )}
                  </div>
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
