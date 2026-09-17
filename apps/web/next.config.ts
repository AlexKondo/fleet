import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@fleet/domain", "@fleet/supabase-client"],
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
