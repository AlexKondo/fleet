import { getDictionary } from "@/lib/i18n/getLocale";

export default async function LoadingCommandCenter() {
  const dict = await getDictionary();
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: 32,
        color: "#08163d",
        background: "#f3f8fe",
        minHeight: "100vh",
      }}
    >
      {dict.commandCenter.loading}
    </div>
  );
}
