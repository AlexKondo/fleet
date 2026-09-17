import Link from "next/link";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { ThemeToggle } from "../ui/ThemeToggle";
import { LanguageToggle } from "../ui/LanguageToggle";
import { getLocale, getDictionary } from "../../lib/i18n/getLocale";

export default async function ForgotPasswordPage() {
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
            Fleet<span className="text-gwm-accent">.</span>
          </p>
          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-fog-400">
            {dict.auth.forgotTitle}
          </p>
        </div>
        <div className="rounded-md border border-line-800 bg-panel-900/60 p-6">
          <ForgotPasswordForm dict={dict} />
        </div>
        <p className="mt-4 text-center text-sm text-fog-400">
          <Link href="/login" className="text-gwm-accent hover:underline">
            {dict.auth.backToLogin}
          </Link>
        </p>
      </div>
    </main>
  );
}
