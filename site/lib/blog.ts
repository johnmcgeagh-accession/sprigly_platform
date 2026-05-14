import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

const BLOG_DIR = path.join(process.cwd(), 'content', 'blog')

export interface BlogPost {
  slug: string
  title: string
  category: string
  excerpt: string
  date: string
  content: string
}

export function getAllPosts(): BlogPost[] {
  if (!fs.existsSync(BLOG_DIR)) return []

  return fs
    .readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith('.mdx'))
    .map((filename) => {
      const slug = filename.replace(/\.mdx$/, '')
      const raw = fs.readFileSync(path.join(BLOG_DIR, filename), 'utf-8')
      const { data, content } = matter(raw)
      return {
        slug,
        title: data.title as string,
        category: data.category as string,
        excerpt: data.excerpt as string,
        date: data.date as string,
        content,
      }
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  const filePath = path.join(BLOG_DIR, `${slug}.mdx`)
  if (!fs.existsSync(filePath)) return undefined
  const raw = fs.readFileSync(filePath, 'utf-8')
  const { data, content } = matter(raw)
  return {
    slug,
    title: data.title as string,
    category: data.category as string,
    excerpt: data.excerpt as string,
    date: data.date as string,
    content,
  }
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
