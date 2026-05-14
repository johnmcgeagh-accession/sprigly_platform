import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { MDXRemote } from 'next-mdx-remote/rsc'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import { getAllPosts, getPostBySlug, formatDate } from '@/lib/blog'
import { SITE_URL } from '@/lib/config'

interface Props {
  params: { slug: string }
}

export async function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = getPostBySlug(params.slug)
  if (!post) return {}

  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: 'article',
      publishedTime: post.date,
    },
    alternates: { canonical: `${SITE_URL}/blog/${post.slug}` },
  }
}

export default function BlogPostPage({ params }: Props) {
  const post = getPostBySlug(params.slug)
  if (!post) notFound()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt,
    datePublished: post.date,
    author: {
      '@type': 'Organization',
      name: 'Sprigly',
    },
    publisher: {
      '@type': 'Organization',
      name: 'Sprigly',
      url: SITE_URL,
    },
    mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Nav />
      <main className="min-h-screen bg-paper">
        <div className="pt-[140px] pb-[130px] px-6 md:px-12">
          <div className="max-w-[720px] mx-auto">
            {/* Back link */}
            <Link
              href="/blog"
              className="inline-flex items-center gap-2 text-[13px] text-ink-light hover:text-coral transition-colors mb-12"
            >
              ← Field notes
            </Link>

            {/* Header */}
            <header className="mb-16">
              <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
                {post.category}
              </p>
              <h1
                className="font-serif font-normal tracking-[-0.025em] text-ink mb-6"
                style={{ fontSize: 'clamp(32px, 4vw, 52px)', lineHeight: 1.05 }}
              >
                {post.title}
              </h1>
              <p
                className="font-serif italic text-[20px] leading-[1.45] text-ink-mid mb-8"
              >
                {post.excerpt}
              </p>
              <time
                dateTime={post.date}
                className="text-[13px] text-ink-light"
              >
                {formatDate(post.date)}
              </time>
            </header>

            {/* MDX content */}
            <article className="prose-article">
              <MDXRemote source={post.content} />
            </article>

            {/* Footer CTA */}
            <div className="mt-20 pt-12 border-t border-ink/10">
              <p className="font-serif italic text-[20px] text-ink-mid mb-6 leading-[1.4]">
                Interested in what this would look like for your business?
              </p>
              <Link
                href="/book"
                className="inline-flex items-center gap-[10px] px-7 py-4 bg-coral text-white rounded-lg font-medium text-[15px] transition-all duration-200 hover:-translate-y-px"
              >
                Book a free discovery call
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
