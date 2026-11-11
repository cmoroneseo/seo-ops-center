import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Isolate local previews from other running Next.js sessions.
  distDir: process.env.NEXT_BUILD_DIR || ".next",
  images: {
    // Next 15 warns, and Next 16 rejects, any quality that is not listed here.
    // 75 stays the default for the rest of the app. Landing product shots opt into 90.
    qualities: [75, 90],
  },
  async headers() {
    return [
      {
        // The client review portal must never be indexed. The metadata robots tag covers
        // crawlers that parse HTML; the header also covers anything that only reads
        // response headers, and applies to the API routes too.
        source: "/:path(review|api/portal)/:rest*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
      {
        source: "/roadmap/:token",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
        ],
      },
    ];
  },
};

export default nextConfig;
