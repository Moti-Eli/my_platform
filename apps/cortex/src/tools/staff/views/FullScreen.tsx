"use client";

/**
 * Staff full screen (Standard §2 `views/FullScreen.tsx`, §8). Cloned from Tasks'
 * full screen, on the app-teal identity accent — but READ-ONLY: no add form and no
 * per-row actions this step. Just the org member list.
 *
 * The read is the SHARED react-query cache (`useStaffMembers`, queryKey
 * ["staff","members"]) — the same entry the dashboard card reads. The query's fetch
 * is the SERVER action (`runIntentAction`), which builds ctx from the session, so
 * every fetch is re-authenticated; no identity is sent from here.
 *
 * This route is ADMIN-ONLY (manifest `requiresAdmin`); the page above re-checks
 * isAdmin server-side and redirects a non-admin before this ever renders. RLS is
 * the real boundary beneath both.
 *
 * Built from design-system utilities + i18n only.
 */
import { useRouter } from "next/navigation";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { ChevronIcon } from "@/components/icons";
import { useStaffMembers } from "@/lib/query/useStaffMembers";
import type { Member } from "../logic";

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
  const { members, isLoading, isError } = useStaffMembers();

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
          {members.map((m) => (
            <li key={m.membershipId} className="flex items-center justify-between gap-sm py-sm">
              <div className="flex min-w-0 flex-col">
                <span className="truncate type-heading text-ink">{memberName(m)}</span>
                <span className="truncate type-label text-muted" dir="ltr">
                  {m.email}
                </span>
              </div>
              {/* Role pill — reuses the profile role-pill style: admin in the accent,
                  member muted. */}
              <span
                className={`shrink-0 rounded-pill px-sm py-2xs type-caption ${
                  m.isAdmin ? "bg-accent/15 text-accent" : "bg-hairline text-muted"
                }`}
              >
                {m.isAdmin ? t("staff.roleAdmin") : t("staff.roleMember")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
