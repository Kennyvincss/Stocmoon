import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@stocmoon/core"],
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  turbopack: {
    // optional deps of wallet SDKs that StocMoon does not use
    resolveAlias: { "@x402/core/client": "./src/lib/stubs/unused-optional.ts", "@x402/evm": "./src/lib/stubs/unused-optional.ts", "@x402/evm/exact/client": "./src/lib/stubs/unused-optional.ts", "@x402/evm/upto/client": "./src/lib/stubs/unused-optional.ts", "@x402/svm/exact/client": "./src/lib/stubs/unused-optional.ts" },
  },

};

export default nextConfig;
