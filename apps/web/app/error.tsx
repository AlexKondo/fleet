"use client";

/**
 * Root error boundary. Catches any otherwise-uncaught error thrown while rendering a
 * Server Component — most relevantly here, MissingEnvVarError from a misconfigured
 * deploy target, which would otherwise reach the visitor as Next.js's generic
 * "a server-side exception has occurred" page with no way back. Next.js redacts
 * `error.message` in production builds before it ever reaches this component (by
 * design, so server-side details never leak to the browser), so this can only show a
 * generic message — the specific cause still goes to the server logs via each call
 * site's own `console.error`, `digest` is the pointer between the two.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink-950 px-6">
      <div className="w-full max-w-md rounded-md border border-line-800 bg-panel-900/60 p-8 text-center">
        <p className="font-display text-2xl font-extrabold uppercase tracking-tight text-paper-50">
          Fleet<span className="text-signal-amber">.</span>
        </p>
        <p className="mt-4 text-sm text-paper-50">Algo deu errado por aqui.</p>
        <p className="mt-2 text-sm text-fog-400">
          Não foi possível carregar esta página agora. Tente novamente em instantes; se o
          problema continuar, avise o administrador do sistema.
        </p>
        {error.digest ? (
          <p className="mt-4 font-mono text-xs text-fog-600">Código: {error.digest}</p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-sm bg-signal-amber px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-amber"
        >
          Tentar novamente
        </button>
      </div>
    </main>
  );
}
