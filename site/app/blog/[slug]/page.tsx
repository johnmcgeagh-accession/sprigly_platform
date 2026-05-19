import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { MDXRemote } from 'next-mdx-remote/rsc'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import { getPostBySlug, formatDate, extractMarkdownBody, extractFaq } from '@/lib/blog'
import { FaqAccordion } from '@/components/FaqAccordion'
import { SITE_URL } from '@/lib/config'

export const dynamic = 'force-dynamic'

interface Props {
  params: { slug: string }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getPostBySlug(params.slug)
  if (!post) return {}

  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt ?? undefined,
      type: 'article',
      publishedTime: post.createdAt.toISOString(),
    },
    alternates: { canonical: `${SITE_URL}/blog/${post.slug}` },
  }
}

export default async function BlogPostPage({ params }: Props) {
  const post = await getPostBySlug(params.slug)
  if (!post) notFound()

  const markdownBody = extractMarkdownBody(post.body)
  const faq = extractFaq(post.body, post.faq)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt,
    datePublished: post.createdAt.toISOString(),
    author: {
      '@type': post.author ? 'Person' : 'Organization',
      name: post.author ?? 'Sprigly',
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

      {/* Coral header */}
      <section
        className="bg-coral px-6 md:px-12"
        style={{ paddingTop: '140px', paddingBottom: '80px' }}
      >
        <div className="max-w-[720px] mx-auto">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-[13px] text-white/70 hover:text-white transition-colors mb-12"
          >
            ← Blog
          </Link>

          <header>
            {post.category && (
              <p className="text-2xs font-medium uppercase tracking-[0.15em] text-white/75 mb-5">
                {post.category}
              </p>
            )}
            <h1
              className="font-serif font-normal tracking-[-0.025em] text-white mb-6"
              style={{ fontSize: 'clamp(32px, 4vw, 52px)', lineHeight: 1.05 }}
            >
              {post.title}
            </h1>
            {post.excerpt && (
              <p className="font-serif italic text-[20px] leading-[1.45] text-white/85 mb-8">
                {post.excerpt}
              </p>
            )}
            <time
              dateTime={post.createdAt.toISOString()}
              className="text-[13px] text-white/60"
            >
              {formatDate(post.createdAt)}
            </time>
          </header>
        </div>
      </section>

      {/* Article content */}
      <main className="bg-paper">
        <div className="px-6 md:px-12 py-20">
          <div className="max-w-[720px] mx-auto">
            <article className="prose-article">
              <MDXRemote source={markdownBody} />
            </article>

            {/* FAQs */}
            {faq.length > 0 && (
              <div className="mt-20 pt-12 border-t border-ink/10">
                <h2
                  className="font-serif font-normal tracking-[-0.02em] text-ink mb-8"
                  style={{ fontSize: 'clamp(24px, 3vw, 32px)' }}
                >
                  Frequently asked questions
                </h2>
                <FaqAccordion items={faq} />
              </div>
            )}

            {/* CTA */}
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
