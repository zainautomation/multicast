import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / server-only packages used by the renderer and publishers.
  serverExternalPackages: ["@resvg/resvg-js", "satori", "sharp", "wawoff2", "isomorphic-dompurify", "bullmq", "@prisma/client", "bcryptjs", "web-push", "nodemailer"],
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
};

export default nextConfig;
