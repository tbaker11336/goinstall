import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@goinstall/core", "@goinstall/db", "@goinstall/integrations"],
  experimental: {
    // Survey photos are resized in the browser first; this leaves headroom.
    serverActions: { bodySizeLimit: "4mb" },
  },
  serverExternalPackages: ["pg", "@react-pdf/renderer"],
};

export default nextConfig;
