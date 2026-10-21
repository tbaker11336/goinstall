import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@goinstall/core", "@goinstall/db", "@goinstall/integrations"],
  experimental: {
    // Survey photos are resized in the browser first; this leaves headroom.
    serverActions: { bodySizeLimit: "4mb" },
  },
  serverExternalPackages: ["pg", "@react-pdf/renderer"],
  // The installer app's web build lives in public/app (scripts/build-installer-web.mjs).
  async redirects() {
    return [{ source: "/app", destination: "/app/index.html", permanent: false }];
  },
};

export default nextConfig;
