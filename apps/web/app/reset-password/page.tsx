import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { ThemeToggle } from "../ui/ThemeToggle";
import { LanguageToggle } from "../ui/LanguageToggle";
import { getLocale, getDictionary } from "../../lib/i18n/getLocale";

export default async function ResetPasswordPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // No session means either a direct visit or an expired/already-used recovery link —
  // auth/callback/route.ts is what establishes the session, and only redirects here on
  // success. Send them back to request a fresh one instead of showing a form that would
  // just fail on submit.
  if (!user) redirect("/forgot-password");

  const locale = await getLocale();
  const dict = await getDictionary();

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-3 flex items-center justify-center gap-3">
          <LanguageToggle locale={locale} dict={dict} />
          <ThemeToggle dict={dict} />
        </div>
        <div className="mb-8 text-center">
          <p className="font-display text-4xl font-extrabold uppercase tracking-tight text-paper-50">
            Fleet<span className="text-signal-amber">.</span>
          </p>
          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-fog-400">
            {dict.auth.resetTitle}
          </p>
        </div>
        <div className="rounded-md border border-line-800 bg-panel-900/60 p-6">
          <ResetPasswordForm dict={dict} />
        </div>
      </div>
    </main>
  );
}
