"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { createOrganizationAction, type CreateOrgState } from "./actions";

const initialState: CreateOrgState = {
  error: null,
  createdOrgName: null,
  createdAdminEmail: null,
  tempPassword: null,
};

export function CreateOrg({ locale }: { locale: string }) {
  const t = useTranslations("platform");
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createOrganizationAction, initialState);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const succeeded = state.error === null && state.createdAdminEmail !== null;

  // Focus + scroll-lock + Escape while open.
  useEffect(() => {
    if (!open) return;
    firstFieldRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Move focus to the first field when switching back from the success view.
  useEffect(() => {
    if (open && !succeeded) firstFieldRef.current?.focus();
  }, [open, succeeded]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.98]"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="size-4">
          <path d="M10 5a.75.75 0 0 1 .75.75v3.5h3.5a.75.75 0 0 1 0 1.5h-3.5v3.5a.75.75 0 0 1-1.5 0v-3.5h-3.5a.75.75 0 0 1 0-1.5h3.5v-3.5A.75.75 0 0 1 10 5Z" />
        </svg>
        {t("createOrg")}
      </button>

      {open && (
        <div
          className="modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-4 backdrop-blur-sm sm:items-center"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-org-title"
            className="modal-panel w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div>
                <h2 id="create-org-title" className="text-lg font-bold text-foreground">
                  {succeeded ? t("createdTitle") : t("createOrg")}
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {succeeded ? t("createdSubtitle") : t("createOrgSubtitle")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("cancel")}
                className="-me-1.5 -mt-1.5 grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="size-4">
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
            </div>

            {succeeded ? (
              <div className="px-6 py-5">
                <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3.5">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="size-4">
                      <path
                        fillRule="evenodd"
                        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.79 6.8-6.79a1 1 0 0 1 1.4 0Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </span>
                  <div className="min-w-0 text-sm">
                    <p className="text-foreground">
                      {t("createdBody", { org: state.createdOrgName ?? "" })}
                    </p>
                    <dl className="mt-2 space-y-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                          {t("createdEmailLabel")}
                        </dt>
                        <dd className="font-medium text-foreground" dir="ltr">
                          {state.createdAdminEmail}
                        </dd>
                      </div>
                      {state.tempPassword ? (
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                            {t("createdTempPasswordLabel")}
                          </dt>
                          <dd className="font-mono font-medium text-foreground" dir="ltr">
                            {state.tempPassword}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                </div>
                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.98]"
                  >
                    {t("done")}
                  </button>
                </div>
              </div>
            ) : (
              <form action={formAction} className="px-6 py-5">
                <input type="hidden" name="locale" value={locale} />
                <div className="space-y-4">
                  <Field label={t("fieldOrgName")} htmlForId="org-name">
                    <input
                      ref={firstFieldRef}
                      id="org-name"
                      name="organizationName"
                      type="text"
                      required
                      autoComplete="off"
                      placeholder={t("fieldOrgNamePlaceholder")}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    />
                  </Field>
                  <Field label={t("fieldAdminEmail")} htmlForId="org-admin-email">
                    <input
                      id="org-admin-email"
                      name="adminEmail"
                      type="email"
                      required
                      autoComplete="off"
                      dir="ltr"
                      placeholder={t("fieldAdminEmailPlaceholder")}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    />
                  </Field>
                  <Field label={t("fieldAdminName")} htmlForId="org-admin-name">
                    <input
                      id="org-admin-name"
                      name="adminDisplayName"
                      type="text"
                      required
                      autoComplete="off"
                      placeholder={t("fieldAdminNamePlaceholder")}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    />
                  </Field>
                </div>

                {state.error ? (
                  <p
                    role="alert"
                    className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {t(state.error)}
                  </p>
                ) : null}

                <div className="mt-6 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={pending}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pending && (
                      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-4 animate-spin">
                        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2.5" className="opacity-25" />
                        <path d="M17 10a7 7 0 0 0-7-7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                      </svg>
                    )}
                    {pending ? t("creating") : t("createOrgSubmit")}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Field({
  label,
  htmlForId,
  children,
}: {
  label: string;
  htmlForId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlForId} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
