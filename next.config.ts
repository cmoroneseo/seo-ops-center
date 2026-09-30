import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Isolate local previews from other running Next.js sessions.
  distDir: process.env.NEXT_BUILD_DIR || ".next",
  async headers() {
    return [
      {
        // The client review portal must never be indexed. The metadata robots tag covers
        // crawlers that parse HTML; the header also covers anything that only reads
        // response headers, and applies to the API routes too.
        source: "/:path(review|api/portal)/:rest*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
    ];
  },
};

export default nextConfig;
