"use client";

/**
 * A back chevron that returns to the previous screen. It is ALWAYS left-pointing
 * and (via its Screen top bar's LTR-physical layout) left-positioned — in both
 * Hebrew and English. It is deliberately NOT mirrored per-locale.
 */
import { useRouter } from "next/navigation";
import { ChevronIcon } from "@/components/icons";
import { useI18n } from "@/i18n";

export function BackButton() {
  const router = useRouter();
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label={t("common.back")}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink touch-manipulation interactive motion-safe:active:scale-[0.97]"
    >
      {/* ChevronIcon points left by default — no per-locale flip. */}
      <ChevronIcon />
    </button>
  );
}
