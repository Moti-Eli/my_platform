"use client";

/**
 * The flat settings-list building blocks (Instagram style): a small muted section
 * header above a group of rows that sit directly on the screen background — no
 * card, no shadow, no dividers. Space between groups does the separating. Each
 * row is an icon at the start, a label, an optional value, and a forward chevron
 * at the end. Shared by the profile and settings screens so they read as one
 * language.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronIcon } from "@/components/icons";
import { useI18n } from "@/i18n";

/** A titled group of rows — separated from the next group by spacing, not lines. */
export function ListSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-lg first:mt-md">
      <h2 className="px-2xs pb-2xs type-label uppercase text-muted">
        {title}
      </h2>
      <div>{children}</div>
    </section>
  );
}

// The one row shape, shared by the navigating row and the action row below so
// their look can never drift apart.
const rowClass = "flex items-center gap-sm px-2xs py-xs touch-manipulation interactive";

/** A navigating row: icon · label · optional value · forward chevron. */
export function ListRow({
  href,
  icon,
  label,
  value,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  /** Optional current value shown before the chevron (e.g. the selected language). */
  value?: ReactNode;
}) {
  const { dir } = useI18n();
  return (
    <Link
      href={href}
      className={rowClass}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card text-accent">
        {icon}
      </span>
      <span className="flex-1 type-heading text-ink">{label}</span>
      {value != null ? <span className="shrink-0 type-label text-muted">{value}</span> : null}
      {/* Forward/disclosure chevron points to the inline-end (RTL: left). */}
      <ChevronIcon
        width={18}
        height={18}
        className="shrink-0 text-muted"
        style={{ transform: dir === "rtl" ? undefined : "scaleX(-1)" }}
      />
    </Link>
  );
}

/**
 * An ACTION row: the same row styling as {@link ListRow}, but a submit button
 * rather than a link (it performs an action, e.g. sign-out — it does not
 * navigate, so there is no chevron). Drop it inside a `<form action={...}>`.
 *
 * `destructive` tints the label with the `danger` token for irreversible actions
 * like sign-out; the row is deliberately icon-less (no exit icon exists in the
 * set, and a lone tinted row reads as a distinct action, not another setting).
 */
export function ListAction({
  label,
  destructive = false,
}: {
  label: string;
  destructive?: boolean;
}) {
  return (
    <button type="submit" className={`${rowClass} w-full text-start`}>
      <span className={`flex-1 type-heading ${destructive ? "text-danger" : "text-ink"}`}>
        {label}
      </span>
    </button>
  );
}

