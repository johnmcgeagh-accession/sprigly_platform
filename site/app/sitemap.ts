import { MetadataRoute } from 'next'
import { getAllPublishedPosts } from '@/lib/blog'
import { SITE_URL } from '@/lib/config'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await getAllPublishedPosts()

  const blogUrls = posts.map((post) => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: post.createdAt,
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }))

  return [
    { url: SITE_URL, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/about`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/blog`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE_URL}/for-founder-led-businesses`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE_URL}/for-estate-agents`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE_URL}/for-financial-advisers`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    ...blogUrls,
  ]
}
