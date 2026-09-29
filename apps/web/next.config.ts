import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@fleet/domain", "@fleet/supabase-client"],
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
    ],
  },
};

export default nextConfig;
