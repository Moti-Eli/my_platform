/**
 * Profile — an EMPTY SHELL with a placeholder "Identity Core" (ליבת זהות) area.
 * No real content yet; spec'd next.
 */
import { UserIcon } from "@/components/icons";

export default function ProfilePage() {
  return (
    <>
      <h1 className="px-1 text-xl font-bold text-ink">פרופיל</h1>

      {/* Identity Core placeholder — structure only. */}
      <section aria-label="ליבת זהות" className="flex flex-col items-center gap-4">
        <div className="flex w-full flex-col items-center gap-4 rounded-xl bg-card px-6 py-10 shadow-soft">
          <span className="flex h-24 w-24 items-center justify-center rounded-full bg-screen text-muted">
            <UserIcon width={44} height={44} />
          </span>
          <p className="text-base font-semibold text-ink">ליבת זהות</p>
          <p className="max-w-[26ch] text-center text-sm text-muted">
            כאן תופיע ליבת הזהות שלך — פרטים, הרשאות והעדפות. שלד בלבד בשלב זה.
          </p>
          <div className="mt-2 flex w-full flex-col gap-2">
            <div className="h-12 w-full rounded-lg bg-screen" />
            <div className="h-12 w-full rounded-lg bg-screen" />
            <div className="h-12 w-3/4 rounded-lg bg-screen" />
          </div>
        </div>
      </section>
    </>
  );
}
