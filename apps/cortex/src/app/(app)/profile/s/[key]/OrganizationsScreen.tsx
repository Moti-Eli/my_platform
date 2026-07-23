"use client";

/**
 * The organizations drill-in, turned into a working org switcher. The server
 * wrapper fetches the user's orgs (RLS-scoped) and passes them in; this screen
 * writes the active-org cookie and reloads so requireSession re-runs and the
 * whole app re-renders against the chosen org.
 *
 * Chrome mirrors {@link PlaceholderScreen}: the shared {@link Screen} frame with
 * the section title centered. The list mirrors the settings pickers (see
 * components/settings/LanguagePicker) — a bg-card container of rounded, tappable
 * rows. The active org is a non-interactive row marked with a check; every other
 * org is a button that switches to it.
 */
import { useRouter } from "next/navigation";
import { Screen } from "@/components/profile/Screen";
import { CheckIcon } from "@/components/icons";
import { ORG_COOKIE, setPreferenceCookie } from "@/lib/cookies";
import { useI18n } from "@/i18n";
import { CreateOrganization } from "./CreateOrganization";

interface OrgRow {
  id: string;
  name: string;
  isAdmin: boolean;
}

export function OrganizationsScreen({
  orgs,
  activeOrgId,
}: {
  orgs: OrgRow[];
  activeOrgId: string;
}) {
  const { t } = useI18n();
  const router = useRouter();

  const switchTo = (id: string) => {
    setPreferenceCookie(ORG_COOKIE, id);
    // Navigate home and re-run the server: requireSession reads the new cookie
    // and every screen re-renders against the chosen org.
    router.push("/");
    router.refresh();
  };

  return (
    <Screen center={<h1 className="truncate type-title text-ink">{t("profile.organizations")}</h1>}>
      <div className="flex flex-col gap-md">
      <div className="flex flex-col gap-xs rounded-lg bg-card p-xs">
        {orgs.map((org) => {
          const role = org.isAdmin ? t("profile.roleAdmin") : t("profile.roleMember");
          const active = org.id === activeOrgId;
          const content = (
            <>
              <span className="flex min-w-0 items-center gap-xs">
                <span className="truncate">{org.name}</span>
                <span className="shrink-0 type-label text-muted">{role}</span>
              </span>
              {active ? <CheckIcon width={18} height={18} className="text-accent" /> : null}
            </>
          );
          return active ? (
            <div
              key={org.id}
              className="flex items-center justify-between rounded-lg bg-screen px-md py-sm type-heading text-ink"
            >
              {content}
            </div>
          ) : (
            <button
              key={org.id}
              type="button"
              onClick={() => switchTo(org.id)}
              className="flex items-center justify-between rounded-lg px-md py-sm type-heading text-muted interactive"
            >
              {content}
            </button>
          );
        })}
      </div>

        {/* Create a new org — sits next to the switcher, deliberately minimal. */}
        <div className="rounded-lg bg-card p-md">
          <CreateOrganization />
        </div>
      </div>
    </Screen>
  );
}
