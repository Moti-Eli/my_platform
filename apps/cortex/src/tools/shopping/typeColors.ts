/**
 * The colours a list type can take — the design system's accent TOKENS, by
 * name. The database stores only the name (`shopping_list_types.color`); this
 * file is the one place that turns a name into classes. The class strings are
 * written out in full so Tailwind sees them (no `bg-app-${name}` building).
 *
 * An unknown name (a token removed later, a bad row) falls back to NEUTRAL, so a
 * type never renders without a colour.
 */

export const TYPE_COLORS = ["amber", "green", "coral", "violet", "blue", "teal"] as const;
export type TypeColor = (typeof TYPE_COLORS)[number];

export interface TypeColorClasses {
  /** A solid dot / swatch. */
  dot: string;
  /** A tinted chip: background + text. */
  chip: string;
  /** A filled (selected) chip: background + on-fill text. */
  filled: string;
}

const CLASSES: Record<TypeColor, TypeColorClasses> = {
  amber: { dot: "bg-app-amber", chip: "bg-app-amber/15 text-app-amber", filled: "bg-app-amber text-on-fill" },
  green: { dot: "bg-app-green", chip: "bg-app-green/15 text-app-green", filled: "bg-app-green text-on-fill" },
  coral: { dot: "bg-app-coral", chip: "bg-app-coral/15 text-app-coral", filled: "bg-app-coral text-on-fill" },
  violet: { dot: "bg-app-violet", chip: "bg-app-violet/15 text-app-violet", filled: "bg-app-violet text-on-fill" },
  blue: { dot: "bg-app-blue", chip: "bg-app-blue/15 text-app-blue", filled: "bg-app-blue text-on-fill" },
  teal: { dot: "bg-app-teal", chip: "bg-app-teal/15 text-app-teal", filled: "bg-app-teal text-on-fill" },
};

const NEUTRAL: TypeColorClasses = {
  dot: "bg-hairline",
  chip: "bg-hairline text-muted",
  filled: "bg-ink text-screen",
};

export function isTypeColor(name: string): name is TypeColor {
  return (TYPE_COLORS as readonly string[]).includes(name);
}

export function typeColorClasses(name: string | null | undefined): TypeColorClasses {
  return name && isTypeColor(name) ? CLASSES[name] : NEUTRAL;
}
