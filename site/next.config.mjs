/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  experimental: {
    serverComponentsExternalPackages: ['postgres', 'drizzle-orm'],
  },
}

export default nextConfig
