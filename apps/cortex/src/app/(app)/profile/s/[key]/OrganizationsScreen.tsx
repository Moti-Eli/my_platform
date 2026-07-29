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
import { Screen } from "@/components/profile/Screen";
import { CheckIcon } from "@/components/icons";
import { ORG_COOKIE, setPreferenceCookie } from "@/lib/cookies";
import { useI18n } from "@/i18n";
import { CreateOrganization } from "./CreateOrganization";
import { RemoveOrganization } from "./RemoveOrganization";

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

  const switchTo = (id: string) => {
    setPreferenceCookie(ORG_COOKIE, id);
    // FULL document load is DELIBERATE — NOT router.push/refresh. The react-query
    // cache is root-mounted and its keys are flat literals (["tasks","list"] …),
    // not org-scoped, so a soft navigation would keep the PREVIOUS org's cached
    // rows on screen (and with staleTime often never refetch them). A full load
    // discards the client cache entirely, so every tool re-reads the chosen org.
    window.location.assign("/");
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
          // The ACTIVE row carries no remove control on purpose: hiding the
          // org you're currently in would strand the active-org cookie, which
          // is out of scope here — switch away first, then remove it.
          return active ? (
            <div
              key={org.id}
              className="flex items-center justify-between rounded-lg bg-screen px-md py-sm type-heading text-ink"
            >
              {content}
            </div>
          ) : (
            // RemoveOrganization wraps the switch control so it can render the
            // refusal error beneath the org name; the switch onClick is unchanged.
            <RemoveOrganization key={org.id} orgId={org.id} orgName={org.name}>
              <button
                type="button"
                onClick={() => switchTo(org.id)}
                className="flex min-w-0 flex-1 items-center justify-between rounded-lg px-md py-sm type-heading text-muted interactive"
              >
                {content}
              </button>
            </RemoveOrganization>
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
