"use client";

/**
 * Language picker — segmented he/en options. Selecting switches the language
 * live (dir flips with it) and persists the choice (cookie).
 */
import { useI18n, locales, type Locale } from "@/i18n";
import { CheckIcon } from "@/components/icons";

const LABEL_KEY: Record<Locale, "settings.languageHe" | "settings.languageEn"> = {
  he: "settings.languageHe",
  en: "settings.languageEn",
};

export function LanguagePicker() {
  const { t, locale, setLocale } = useI18n();

  return (
    <div className="flex flex-col gap-xs rounded-xl bg-card p-xs shadow-soft">
      {locales.map((code) => {
        const active = code === locale;
        return (
          <button
            key={code}
            type="button"
            onClick={() => setLocale(code)}
            aria-pressed={active}
            className={`flex items-center justify-between rounded-lg px-md py-sm type-heading transition ${
              active ? "bg-screen text-ink" : "text-muted active:scale-[0.99]"
            }`}
          >
            <span>{t(LABEL_KEY[code])}</span>
            {active ? <CheckIcon width={18} height={18} className="text-accent" /> : null}
          </button>
        );
      })}
    </div>
  );
}
