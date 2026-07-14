/**
 * TEMPORARY PLACEHOLDER APPS — throwaway UI only, NOT registered tools (no
 * manifest / intents / schema / logic). They exist purely so the shell can be
 * exercised with several apps at once: this one list drives the stub chips in
 * the app-tabs row, the "הכל" preview grid on Home, and the placeholder screens
 * under app/tools/*. Delete this file (and those pages) once real tools land.
 */
import type { ComponentType, SVGProps } from "react";
import { GridIcon, CheckIcon, SparkIcon, UserIcon, BoxIcon, PinIcon } from "@/components/icons";
import type { MessageKey } from "@/i18n";

export interface PlaceholderApp {
  id: string;
  route: string;
  labelKey: MessageKey;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

export const PLACEHOLDER_APPS: PlaceholderApp[] = [
  { id: "calendar", route: "/tools/calendar", labelKey: "placeholders.calendar", Icon: GridIcon },
  { id: "tasks", route: "/tools/tasks", labelKey: "placeholders.tasks", Icon: CheckIcon },
  { id: "fitness", route: "/tools/fitness", labelKey: "placeholders.fitness", Icon: SparkIcon },
  { id: "contacts", route: "/tools/contacts", labelKey: "placeholders.contacts", Icon: UserIcon },
  { id: "expenses", route: "/tools/expenses", labelKey: "placeholders.expenses", Icon: BoxIcon },
  { id: "notes", route: "/tools/notes", labelKey: "placeholders.notes", Icon: PinIcon },
];
