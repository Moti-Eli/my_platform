"use client";

/**
 * What an org member who is NOT a manager and NOT in shift_employees sees when
 * they open the tool: a plain explanation, not a silent redirect (a redirect to
 * the catalog reads as a bug). The manager adds people in the Employees section.
 */
import { useI18n } from "@/i18n";
import { EmptyCard, ToolHeader } from "./shared";

export function NotInToolScreen() {
  const { t } = useI18n();
  return (
    <>
      <ToolHeader title={t("shifts.name")} />
      <EmptyCard titleKey="shifts.notInToolTitle" hintKey="shifts.notInToolHint" />
    </>
  );
}
