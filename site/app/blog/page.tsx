import type { Metadata } from 'next'
import Link from 'next/link'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import { getAllPosts, formatDate } from '@/lib/blog'
import { SITE_URL } from '@/lib/config'

export const metadata: Metadata = {
  title: 'Field notes',
  description: 'Thinking from Sprigly on AI agents, automation, and how small businesses can use them practically.',
  alternates: { canonical: `${SITE_URL}/blog` },
}

export default function BlogIndexPage() {
  const posts = getAllPosts()

  return (
    <>
      <Nav />
      <main className="min-h-screen bg-paper">
        <div className="pt-[140px] pb-[130px] px-6 md:px-12 max-w-[1200px] mx-auto">
          <div className="max-w-[800px] mb-[72px]">
            <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
              Field notes
            </p>
            <h1
              className="font-serif font-normal tracking-[-0.025em] text-ink"
              style={{ fontSize: 'clamp(36px, 4.5vw, 56px)', lineHeight: 1.05 }}
            >
              Thinking on AI, agents, and how small businesses use them.
            </h1>
          </div>

          {posts.length === 0 ? (
            <p className="text-[17px] text-ink-mid">No posts yet. Check back soon.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {posts.map((post) => (
                <article
                  key={post.slug}
                  className="bg-white p-10 flex flex-col rounded-[20px] border border-ink/10 transition-all duration-500 hover:-translate-y-2 hover:border-coral/25 hover:shadow-[0_24px_48px_rgba(31,26,24,0.06)]"
                  style={{ padding: '40px 36px' }}
                >
                  <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-coral mb-4">
                    {post.category}
                  </p>
                  <h2 className="font-serif font-medium text-[22px] tracking-[-0.015em] leading-[1.2] mb-3 text-ink">
                    <Link
                      href={`/blog/${post.slug}`}
                      className="hover:text-coral transition-colors"
                    >
                      {post.title}
                    </Link>
                  </h2>
                  <p className="text-[15px] leading-[1.55] text-ink-mid mb-6 flex-grow">
                    {post.excerpt}
                  </p>
                  <time dateTime={post.date} className="text-[13px] text-ink-light">
                    {formatDate(post.date)}
                  </time>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  )
}
