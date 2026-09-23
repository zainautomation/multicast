import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / server-only packages used by the renderer and publishers.
  serverExternalPackages: ["@resvg/resvg-js", "satori", "sharp", "wawoff2", "isomorphic-dompurify", "bullmq", "@prisma/client", "bcryptjs", "web-push", "nodemailer"],
  // Fonts are read from disk by the image renderer; make sure they ship with the functions.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/@fontsource/fraunces/files/fraunces-latin-*-normal.woff", "./node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-*-normal.woff"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
};

export default nextConfig;
