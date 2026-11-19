"use client";

/**
 * Profile — a full-bleed, WhatsApp-style screen (the shell hides its own header +
 * chips for this route; see AppShell `fullBleed`). A FIXED top bar (menu · name +
 * avatar · back) sits above a scrolling body: a large tappable avatar, the name
 * and a contact placeholder, then grouped settings-list sections. Every row leads
 * to a placeholder screen for now — no logic, and NO hardcoded app list (the
 * "apps summary" row will later read the registry via intents, like the chips).
 *
 * Under the name: the person's STATUS in the active org, as tags — "owner" for an
 * org admin, plus one tag per shift position (the manager's own free-text names,
 * from the shifts tool). Several at once is normal. A small badge on the avatar
 * opens the edit-profile screen (name only for now).
 *
 * The large avatar itself is the profile photo control ({@link AvatarPicker}): tap to
 * choose or remove a photo. The photo also shows in the top bar's small circle.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Screen } from "@/components/profile/Screen";
import { ListSection, ListRow, ListAction } from "@/components/profile/SettingsList";
import { placeholderRoute } from "@/components/profile/placeholders";
import { signOutAction } from "./actions";
import { AvatarPicker } from "./AvatarPicker";
import {
  MenuIcon,
  IdCardIcon,
  UserIcon,
  BuildingIcon,
  BoxIcon,
  DocumentIcon,
  ClockIcon,
  SparkIcon,
  GearIcon,
  PencilIcon,
} from "@/components/icons";
import { useI18n, type MessageKey } from "@/i18n";

interface Row {
  key: string;
  href: string;
  icon: ReactNode;
  labelKey: MessageKey;
}
interface Group {
  titleKey: MessageKey;
  rows: Row[];
}

const GROUPS: Group[] = [
  {
    titleKey: "profile.sectionIdentity",
    rows: [
      { key: "identity-card", href: placeholderRoute("identity-card"), icon: <IdCardIcon />, labelKey: "profile.identityCard" },
      { key: "personal-details", href: placeholderRoute("personal-details"), icon: <UserIcon />, labelKey: "profile.personalDetails" },
      { key: "organizations", href: placeholderRoute("organizations"), icon: <BuildingIcon />, labelKey: "profile.organizations" },
    ],
  },
  {
    titleKey: "profile.sectionData",
    rows: [
      { key: "apps-summary", href: placeholderRoute("apps-summary"), icon: <BoxIcon />, labelKey: "profile.appsSummary" },
      { key: "documents", href: placeholderRoute("documents"), icon: <DocumentIcon />, labelKey: "profile.documents" },
    ],
  },
  {
    titleKey: "profile.sectionActivity",
    rows: [
      { key: "recent-activity", href: placeholderRoute("recent-activity"), icon: <ClockIcon />, labelKey: "profile.recentActivity" },
      { key: "ai-activity", href: placeholderRoute("ai-activity"), icon: <SparkIcon />, labelKey: "profile.aiActivity" },
    ],
  },
  {
    titleKey: "profile.sectionSystem",
    // Settings is a real screen — the only non-placeholder row.
    rows: [{ key: "settings", href: "/settings", icon: <GearIcon />, labelKey: "common.settings" }],
  },
];

interface ProfileViewProps {
  /** public.users.display_name — may be null (fall back to the email local part). */
  displayName: string | null;
  /** The auth user's email. */
  email: string;
  /** The active organization's name. */
  orgName: string;
  /** Whether the user is an admin in the active org (from requireSession). */
  isAdmin: boolean;
  /** The user's shift position names in the active org (shifts tool), in order. */
  positions: string[];
  /** The signed-in user's id (from requireSession) — the photo's storage folder. */
  userId: string;
  /** A short-lived signed URL for the profile photo, or null when there is none. */
  avatarUrl: string | null;
}

export function ProfileView({
  displayName,
  email,
  orgName,
  isAdmin,
  positions,
  userId,
  avatarUrl,
}: ProfileViewProps) {
  const { t } = useI18n();
  // The REAL name now, falling back to the email's local part when display_name
  // is null — never the old static i18n string.
  const name = displayName ?? email.split("@")[0] ?? "";
  const initial = [...name][0] ?? "";

  return (
    <Screen
      center={
        <>
          <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-accent/15 type-caption text-accent">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, 28px
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              initial
            )}
          </span>
          <span className="type-label text-ink">{name}</span>
        </>
      }
      right={
        <Link
          href="/settings"
          aria-label={t("profile.menu")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink interactive motion-safe:active:scale-[0.97]"
        >
          <MenuIcon />
        </Link>
      }
    >
      {/* Header: large tappable avatar + name + contact placeholder. */}
      <div className="flex flex-col items-center gap-sm pb-xs pt-lg">
        <div className="relative">
          <AvatarPicker userId={userId} avatarUrl={avatarUrl} initial={initial} />
          {/* Edit badge — sits on the avatar's bottom inline-end edge. */}
          <Link
            href="/profile/edit"
            aria-label={t("profile.editProfile")}
            className="absolute bottom-0 end-0 flex h-9 w-9 items-center justify-center rounded-full bg-accent text-on-fill ring-2 ring-screen interactive motion-safe:active:scale-[0.97]"
          >
            <PencilIcon width={16} height={16} />
          </Link>
        </div>
        <div className="flex flex-col items-center gap-2xs">
          <span className="type-title text-ink">{name}</span>
          {/* Email is LTR even under an RTL layout. */}
          <span className="type-label text-muted" dir="ltr">{email}</span>
          {orgName ? <span className="type-label text-muted">{orgName}</span> : null}
          {/* Status tags: owner in the accent, shift positions muted. Wraps when
              there are many; none at all when the user has no status here. */}
          {isAdmin || positions.length > 0 ? (
            <ul className="flex flex-wrap items-center justify-center gap-xs pt-2xs">
              {isAdmin ? (
                <li className="rounded-pill bg-accent/15 px-sm py-2xs type-caption text-accent">
                  {t("profile.statusOwner")}
                </li>
              ) : null}
              {positions.map((name) => (
                <li key={name} className="rounded-pill bg-hairline px-sm py-2xs type-caption text-muted">
                  {name}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {GROUPS.map((group) => (
        <ListSection key={group.titleKey} title={t(group.titleKey)}>
          {group.rows.map((row) => (
            <ListRow key={row.key} href={row.href} icon={row.icon} label={t(row.labelKey)} />
          ))}
        </ListSection>
      ))}

      {/* Sign-out — its own section, a lone destructive action. The form posts to
          the server action, which clears the session cookies and redirects to
          /login. */}
      <ListSection title={t("profile.sectionSession")}>
        <form action={signOutAction}>
          <ListAction label={t("session.signOut")} destructive />
        </form>
      </ListSection>
    </Screen>
  );
}
