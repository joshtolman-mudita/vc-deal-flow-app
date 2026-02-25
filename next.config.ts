import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',
  
  // Configure image optimization
  images: {
    unoptimized: true, // For Cloud Run compatibility
  },

  // Increase body size limit for file uploads (default is 10MB)
  // Allow up to 50MB for document uploads in diligence
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
    // Increase request body size limit for API routes and middleware
    proxyTimeout: 300000, // 5 minutes
    // This is the critical setting for API route uploads!
    proxyClientMaxBodySize: '50mb', // Renamed from middlewareClientMaxBodySize
  },

  // Suppress Turbopack/webpack warning (Turbopack handles externals automatically)
  turbopack: {},
};

export default nextConfig;



