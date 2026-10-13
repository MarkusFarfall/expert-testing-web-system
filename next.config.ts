import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: { "/api/**": ["./public/fonts/DejaVuSans.ttf"] },
};

export default nextConfig;
