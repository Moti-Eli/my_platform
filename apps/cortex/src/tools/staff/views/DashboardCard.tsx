"use client";

/**
 * Staff dashboard card (Standard §2 `views/DashboardCard.tsx`, §8). Cloned from
 * Tasks' card, on the app-teal identity accent. READ-ONLY.
 *
 * THREE STATES, MODELLED EXPLICITLY:
 *   - loading             → a skeleton (header as-is + placeholder rows).
 *   - loaded, has members → the member count + the first few, each with a role marker.
 *   - loaded, no members  → an explicit empty body, not a blank card.
 *   - error               → a short muted "couldn't load" line, never silently blank.
 *
 * Reads through the SHARED react-query cache (`useStaffMembers`, queryKey
 * ["staff","members"]) — the SAME cache the full screen uses, so opening the full
 * screen paints instantly from cache. The query's fetch is the SERVER action
 * (`runIntentAction`), which builds ctx from the session, so every fetch is
 * re-authenticated; the client never carries identity.
 */
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { UserIcon } from "@/components/icons";
import { useStaffMembers } from "@/lib/query/useStaffMembers";
import type { Member } from "../logic";

/** Cap on preview rows so the Home card stays a fixed height (matching the other
 * preview cards) — the header count still shows the real total. */
const MAX_PREVIEW_ROWS = 4;

/** Muted placeholder block. `bg-hairline` is a token; `motion-safe:animate-pulse`
 * so reduced-motion users get a static (still visible) skeleton, not a pulse. */
const SKELETON = "rounded-md bg-hairline motion-safe:animate-pulse";

/** A member's display name, falling back to the email's local part when unset. */
function memberName(m: Member): string {
  return m.displayName ?? m.email.split("@")[0] ?? "";
}

// The page passes userId/orgId (it called requireSession()), but this view does
// NOT send them anywhere: the server action derives identity from the session
// cookie, never from a client-supplied value. `_props` marks them unused here.
export function DashboardCard(_props: ToolViewProps) {
  const { t } = useI18n();
  // From the shared query cache. react-query's `isLoading` is "pending AND no cached
  // data yet", so the skeleton shows only on the very first load.
  const { members, isLoading: loading, isError: error } = useStaffMembers();

  return (
    <div className="rounded-lg bg-card p-md">
      <div className="mb-sm flex items-center justify-between">
        <div className="flex items-center gap-xs">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-app-teal/15 text-app-teal">
            <UserIcon width={20} height={20} />
          </span>
          <span className="type-heading text-ink">{t("staff.name")}</span>
        </div>
        {/* Status: a skeleton while loading, nothing on error (the body carries the
            message), the member count otherwise. */}
        {loading ? (
          <span className={`h-4 w-20 ${SKELETON}`} aria-hidden="true" />
        ) : error ? null : (
          <span className="type-label text-muted">
            {members.length} {t("staff.members")}
          </span>
        )}
      </div>

      {loading ? (
        <ul className="flex flex-col divide-y divide-hairline" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center justify-between py-sm">
              <span className={`h-4 w-28 ${SKELETON}`} />
              <span className={`h-4 w-12 ${SKELETON}`} />
            </li>
          ))}
        </ul>
      ) : error ? (
        <p className="type-label text-muted">{t("staff.loadFailed")}</p>
      ) : members.length > 0 ? (
        <ul className="flex flex-col divide-y divide-hairline">
          {members.slice(0, MAX_PREVIEW_ROWS).map((m) => (
            <li key={m.membershipId} className="flex items-center justify-between gap-sm py-sm">
              <span className="truncate type-body text-ink">{memberName(m)}</span>
              {/* Role marker: admin in the accent, member muted. */}
              <span
                className={`shrink-0 type-label ${m.isAdmin ? "text-accent" : "text-muted"}`}
              >
                {m.isAdmin ? t("staff.roleAdmin") : t("staff.roleMember")}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="type-label text-muted">{t("staff.emptyTitle")}</p>
      )}
    </div>
  );
}
