/**
 * "צ'אט" (comms) — placeholder empty screen (slot 4). Real communications come
 * later.
 */
import { EmptyState } from "@/components/EmptyState";
import { ChatIcon } from "@/components/icons";

export default function CommsPage() {
  return (
    <>
      <h1 className="px-1 text-xl font-bold text-ink">צ'אט</h1>
      <section className="flex flex-1 flex-col">
        <EmptyState
          icon={<ChatIcon />}
          title="אין שיחות עדיין"
          hint="כאן תתנהל התקשורת עם הצוות והכלים."
        />
      </section>
    </>
  );
}
