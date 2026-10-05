/**
 * Resolve a manifest's design-system references (icon id + palette color token)
 * into concrete render bits. Manifests only ever store *references* (Standard §1
 * law 6); this is the single place the shell maps those to real icons/classes,
 * so no screen hard-codes them.
 *
 * The color classes are written as full static strings (not interpolated) so
 * Tailwind detects them. Unknown ids fall back to a neutral default.
 */
import type { ComponentType, SVGProps } from "react";
import {
  BoxIcon,
  GridIcon,
  CheckIcon,
  SparkIcon,
  UserIcon,
  PinIcon,
  ChatIcon,
  BellIcon,
  GearIcon,
  HomeIcon,
  SearchIcon,
  DocumentIcon,
  WalletIcon,
  BookIcon,
  IdCardIcon,
  ClockIcon,
  SendIcon,
} from "@/components/icons";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const ICONS: Record<string, IconComponent> = {
  box: BoxIcon,
  grid: GridIcon,
  check: CheckIcon,
  spark: SparkIcon,
  user: UserIcon,
  pin: PinIcon,
  chat: ChatIcon,
  bell: BellIcon,
  gear: GearIcon,
  home: HomeIcon,
  search: SearchIcon,
  document: DocumentIcon,
  wallet: WalletIcon,
  book: BookIcon,
  idcard: IdCardIcon,
  clock: ClockIcon,
  send: SendIcon,
};

/** The icon component for a manifest `icon` id (falls back to a generic box). */
export function appIcon(icon: string): IconComponent {
  return ICONS[icon] ?? BoxIcon;
}

/** Tinted-circle classes (`bg-<color>/15 text-<color>`) for a palette token. */
const COLOR_CLASSES: Record<string, string> = {
  indigo: "bg-app-violet/15 text-app-violet",
  teal: "bg-app-teal/15 text-app-teal",
  coral: "bg-app-coral/15 text-app-coral",
  amber: "bg-app-amber/15 text-app-amber",
  green: "bg-app-green/15 text-app-green",
  blue: "bg-app-blue/15 text-app-blue",
};

/** The tinted icon-circle classes for a manifest `color` token. */
export function appColorClasses(color: string): string {
  return COLOR_CLASSES[color] ?? COLOR_CLASSES.indigo;
}
