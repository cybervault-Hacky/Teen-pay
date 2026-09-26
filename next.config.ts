import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Development only: allow cloud live-preview hosts (HMR + dev endpoints).
  // Has no effect on production builds.
  allowedDevOrigins: ["*.e2b.app"],
};

export default nextConfig;
