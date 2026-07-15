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
    <section className="mt-6 first:mt-4">
      <h2 className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </h2>
      <div>{children}</div>
    </section>
  );
}

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
      className="flex items-center gap-3 px-1 py-2 touch-manipulation transition active:transition-none active:bg-hairline"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card text-accent">
        {icon}
      </span>
      <span className="flex-1 text-sm font-medium text-ink">{label}</span>
      {value != null ? <span className="shrink-0 text-sm text-muted">{value}</span> : null}
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

