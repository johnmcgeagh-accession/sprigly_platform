import Link from 'next/link'
import { getAllPosts, formatDate } from '@/lib/blog'
import { Reveal } from './Reveal'

export default function BlogSection() {
  const posts = getAllPosts().slice(0, 3)

  if (posts.length === 0) return null

  return (
    <section className="py-[130px] px-6 md:px-12 bg-paper border-t border-ink/10">
      <div className="max-w-[1200px] mx-auto">
        <Reveal className="flex items-end justify-between mb-[72px] gap-8 flex-wrap">
          <div>
            <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
              Latest thinking
            </p>
            <h2
              className="font-serif font-normal tracking-[-0.025em] text-ink"
              style={{ fontSize: 'clamp(36px, 4.5vw, 56px)', lineHeight: 1.05 }}
            >
              Field notes.
            </h2>
          </div>
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-[14px] text-coral font-medium shrink-0 hover:gap-3 transition-all duration-200"
          >
            All posts
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </Link>
        </Reveal>

        <Reveal stagger className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {posts.map((post) => (
            <article
              key={post.slug}
              className="bg-white flex flex-col rounded-[20px] border border-ink/10 transition-all duration-500 hover:-translate-y-2 hover:border-coral/25 hover:shadow-[0_24px_48px_rgba(31,26,24,0.06)]"
              style={{ padding: '40px 36px' }}
            >
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-coral mb-4">
                {post.category}
              </p>
              {/* Title is the link — gives descriptive link text */}
              <h3 className="font-serif font-medium text-[22px] tracking-[-0.015em] leading-[1.2] mb-3 text-ink">
                <Link
                  href={`/blog/${post.slug}`}
                  className="hover:text-coral transition-colors"
                >
                  {post.title}
                </Link>
              </h3>
              <p className="text-[15px] leading-[1.55] text-ink-mid mb-6 flex-grow">
                {post.excerpt}
              </p>
              <time dateTime={post.date} className="text-[13px] text-ink-light">
                {formatDate(post.date)}
              </time>
            </article>
          ))}
        </Reveal>
      </div>
    </section>
  )
}
