import type { NextConfig } from "next";

// Застосунок повністю персоналізований (сесія користувача), тому
// cacheComponents/partialPrefetching не вмикаються: кожна сторінка рендериться
// динамічно з урахуванням прав доступу.
//
// Content-Security-Policy задається в src/proxy.ts під час запиту, бо залежить
// від адреси Supabase, яка відома лише під час запуску (Docker-образ один для
// будь-якого розгортання).

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
