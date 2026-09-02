import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@fleet/domain", "@fleet/supabase-client"],
};

export default nextConfig;
