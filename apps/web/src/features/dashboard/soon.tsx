"use client";

/**
 * The shell's single client piece: placeholder surfaces (`Soon`) that float a
 * transient "Coming soon" toast when clicked, via a shared provider. Every
 * card, tab and top-bar control in the shell is a Soon — nothing navigates.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

const SoonContext = createContext<(() => void) | null>(null);

export function SoonProvider({ label, children }: { label: string; children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nudge = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(true);
    timer.current = setTimeout(() => setVisible(false), 1400);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return (
    <SoonContext.Provider value={nudge}>
      {children}
      <div
        aria-live="polite"
        className={`pointer-events-none fixed inset-x-0 bottom-24 z-30 flex justify-center transition-all duration-200 lg:bottom-10 ${
          visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        }`}
      >
        <span className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background shadow-lg">
          {label}
        </span>
      </div>
    </SoonContext.Provider>
  );
}

interface SoonProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
  title?: string;
}

/** A button-shaped placeholder: looks real, only nudges "coming soon". */
export function Soon({ children, className, style, title, "aria-label": ariaLabel }: SoonProps) {
  const nudge = useContext(SoonContext);
  return (
    <button
      type="button"
      onClick={nudge ?? undefined}
      className={className}
      style={style}
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}
