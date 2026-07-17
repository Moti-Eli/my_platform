"use client";

/**
 * Profile — a full-bleed, WhatsApp-style screen (the shell hides its own header +
 * chips for this route; see AppShell `fullBleed`). A FIXED top bar (menu · name +
 * avatar · back) sits above a scrolling body: a large tappable avatar, the name
 * and a contact placeholder, then grouped settings-list sections. Every row leads
 * to a placeholder screen for now — no logic, and NO hardcoded app list (the
 * "apps summary" row will later read the registry via intents, like the chips).
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Screen } from "@/components/profile/Screen";
import { ListSection, ListRow, ListAction } from "@/components/profile/SettingsList";
import { placeholderRoute } from "@/components/profile/placeholders";
import { signOutAction } from "./actions";
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

export function ProfileView() {
  const { t } = useI18n();
  const name = t("profile.name");
  const initial = [...name][0] ?? "";

  // Wired to a no-op for now — image upload lands later.
  const changePhoto = () => {
    /* placeholder: pick/upload avatar image */
  };

  return (
    <Screen
      center={
        <>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 type-caption text-accent">
            {initial}
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
        <button
          type="button"
          onClick={changePhoto}
          aria-label={t("profile.changePhoto")}
          className="flex h-28 w-28 items-center justify-center rounded-full bg-accent/15 type-display text-accent interactive motion-safe:active:scale-[0.97]"
        >
          {initial}
        </button>
        <div className="flex flex-col items-center gap-2xs">
          <span className="type-title text-ink">{name}</span>
          <span className="type-label text-muted">{t("profile.contactPlaceholder")}</span>
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
