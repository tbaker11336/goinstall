import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@goinstall/core", "@goinstall/db"],
  serverExternalPackages: ["pg"],
};

export default nextConfig;
