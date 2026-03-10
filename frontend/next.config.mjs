/** @type {import('next').NextConfig} */
const backendApiBase = (process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/+$/g, "");

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    if (!backendApiBase) {
      return [];
    }

    return [
      { source: "/api/assets", destination: `${backendApiBase}/api/assets` },
      { source: "/api/asset/:path*", destination: `${backendApiBase}/api/asset/:path*` },
      { source: "/api/reference/:path*", destination: `${backendApiBase}/api/reference/:path*` },
      { source: "/api/news", destination: `${backendApiBase}/api/news` },
      { source: "/api/news/:path*", destination: `${backendApiBase}/api/news/:path*` },
      { source: "/api/macro/:path*", destination: `${backendApiBase}/api/macro/:path*` },
      { source: "/api/heatmap", destination: `${backendApiBase}/api/heatmap` },
      { source: "/api/heatmap/:path*", destination: `${backendApiBase}/api/heatmap/:path*` },
      { source: "/api/opportunities", destination: `${backendApiBase}/api/opportunities` },
      { source: "/api/alerts", destination: `${backendApiBase}/api/alerts` },
      { source: "/api/geo/:path*", destination: `${backendApiBase}/api/geo/:path*` },
      { source: "/api/events/:path*", destination: `${backendApiBase}/api/events/:path*` },
      { source: "/api/overlay/:path*", destination: `${backendApiBase}/api/overlay/:path*` },
      { source: "/api/diagnostics", destination: `${backendApiBase}/api/diagnostics` },
    ];
  },
};

export default nextConfig;
