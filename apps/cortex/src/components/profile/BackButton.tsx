"use client";

/**
 * A back chevron that returns to the previous screen. The glyph points toward
 * the inline-start (RTL: right) — the "back" direction — flipping with locale.
 */
import { useRouter } from "next/navigation";
import { ChevronIcon } from "@/components/icons";
import { useI18n } from "@/i18n";

export function BackButton() {
  const router = useRouter();
  const { t, dir } = useI18n();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label={t("common.back")}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink transition active:scale-95"
    >
      <ChevronIcon style={{ transform: dir === "rtl" ? "scaleX(-1)" : undefined }} />
    </button>
  );
}
