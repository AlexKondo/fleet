import Link from "next/link";
import { LoginForm } from "./LoginForm";
import { LoginRecovery } from "./LoginRecovery";
import { Card } from "../ui/Card";
import { ThemeToggle } from "../ui/ThemeToggle";
import { LanguageToggle } from "../ui/LanguageToggle";
import { getLocale, getDictionary } from "../../lib/i18n/getLocale";

export default async function LoginPage() {
  const locale = await getLocale();
  const dict = await getDictionary();

  return (
    <LoginRecovery dict={dict}>
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
            <p className="mt-1 text-xs uppercase tracking-[0.2em] text-fog-400">{dict.login.tagline}</p>
          </div>
          <Card>
            <LoginForm dict={dict} />
          </Card>
          <p className="mt-4 text-center text-sm text-fog-400">
            {dict.login.noAccount}{" "}
            <Link href="/signup" className="text-gwm-accent hover:underline">
              {dict.login.createAccount}
            </Link>
          </p>
        </div>
      </main>
    </LoginRecovery>
  );
}
