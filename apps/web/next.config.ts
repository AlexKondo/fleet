import type { NextConfig } from "next";

// The configured Supabase origin (local stack in dev/homolog, *.supabase.co in prod). Vehicle
// photos are in the PRIVATE `vehicle-photos` bucket and are rendered from short-lived signed
// URLs (/storage/v1/object/sign/...), so the allow-list must cover that path on this host too.
const supabaseOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL) : null;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  transpilePackages: ["@fleet/domain", "@fleet/supabase-client"],
  experimental: {
    // Router cache for dynamic pages: a page visited in the last 30 s opens instantly when the user comes back to it
    // (sidebar links, back button). Mutations (server actions, revalidatePath, redirect) clear it, so what the user just
    // changed is never shown stale. Default is 0 (every click waits for the server).
    staleTimes: { dynamic: 30, static: 180 },
    // Server Actions default to a 1MB request body — silently below the 5MB photo/PDF
    // limit the CNH upload screen actually advertises (account/license/actions.ts), which
    // is why a real CNH Digital PDF (routinely 1-3MB) failed with a generic "couldn't
    // analyze" error instead of ever reaching analyzeDriversLicense.ts. Matches that 5MB
    // limit with headroom for multipart/base64 overhead.
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
  // @napi-rs/canvas ships a compiled native .node addon (renderPdfPageToPng.ts) — without
  // this, webpack tries to parse that binary as a JS module and the build fails outright
  // ("Module parse failed: Unexpected character"). Marking it external tells Next to
  // leave it as a plain Node require() at runtime instead of bundling it, which is how
  // native addons are supposed to be loaded in a serverless function anyway.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
  // pdf.js's standard font glyph data (renderPdfPageToPng.ts) is loaded from disk at
  // runtime via a computed path string, not a static import/require — Next's file-tracing
  // only bundles files it can see referenced statically, so without this the serverless
  // function ships without them. Points at lib/domain/pdf-standard-fonts (copied into the
  // repo) rather than node_modules/pdfjs-dist/standard_fonts specifically because the
  // latter is a pnpm symlink, which made Vercel's packaging step fail outright ("invalid
  // deployment package... files in symlinked directories") — plain files in the repo
  // don't have that problem.
  outputFileTracingIncludes: {
    "app/account/license/**": ["./lib/domain/pdf-standard-fonts/**"],
  },
  images: {
    // Vehicle photos live in Supabase Storage. Without this allow-list `next/image`
    // refuses the URL outright, which is why these were plain `<img>` tags serving the
    // full-size camera upload (often 2-4 MB) into a 128px-tall card — the single largest
    // transfer on /fleet. The host is a wildcard rather than the project ref because the
    // Supabase URL is a deploy-time env var (Vercel project settings), not something
    // committed to the repo, so it differs per environment.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      // Signed URLs of the private bucket (createSignedUrls in app/fleet/page.tsx). Without
      // this, any vehicle with a photo made next/image throw and /fleet fell into the error
      // boundary for every user.
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/sign/**",
      },
      ...(supabaseOrigin
        ? [
            {
              protocol: supabaseOrigin.protocol.replace(":", "") as "http" | "https",
              hostname: supabaseOrigin.hostname,
              port: supabaseOrigin.port,
              pathname: "/storage/v1/object/**",
            },
          ]
        : []),
    ],
  },
};

export default nextConfig;
