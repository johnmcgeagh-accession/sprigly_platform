# Auxenic — Production site

Next.js 14, TypeScript, Tailwind CSS. Deploy target: Vercel.

## Local development

```bash
cd auxenic-site
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy to Vercel

```bash
vercel deploy
```

No additional environment variables are required for the base site. Vercel Analytics and Speed Insights activate automatically on deployment.

---

## How to add a blog post

1. Create a new `.mdx` file in `content/blog/`:

```
content/blog/my-new-post.mdx
```

2. Add frontmatter at the top:

```mdx
---
title: "Your post title"
category: "AI in plain English"
excerpt: "One or two sentences that appear on the card and as the meta description."
date: "2025-11-01"
---

Your post content in Markdown here.
```

3. The post is available immediately at `/blog/my-new-post`. No config changes needed.

**Supported categories (for styling consistency):** `"AI in plain English"`, `"How we did it"`. Add new ones freely — they inherit the same coral uppercase style.

---

## How to swap the booking URL

All CTAs on the site point to a single constant. Open `lib/config.ts`:

```ts
export const BOOKING_URL = '/book'
```

Replace `/book` with your Cal.com, SavvyCal, or Calendly link:

```ts
export const BOOKING_URL = 'https://cal.com/auxenic/30min'
```

Every "Book a call" button on the site updates immediately. No need to hunt through components.

---

## Where to replace the testimonial

The trust strip testimonial is in `components/TrustStrip.tsx`. Look for the comment:

```tsx
{/* Swap this testimonial when a real attributed one is available */}
```

Replace the `<blockquote>` content with the real quote, name, and company. Remove the "Anonymised at client's request" line once you have a named attribution.

---

## Production URL

The site URL used for OG tags, sitemaps, and canonical URLs is set in `lib/config.ts`:

```ts
export const SITE_URL = 'https://www.auxenic.co.uk'
```

Update this before going live.

---

## Hero image

The hero image (`public/hero.png`) is served via `next/image` with `priority` and AVIF/WebP fallbacks. To swap it: replace `public/hero.png` with a new image at the same path. The CSS filter treatment (grayscale, brightness, contrast, blend layers) is applied in `components/Hero.tsx` and will carry over automatically.

---

## Design tokens

All brand colours and fonts are defined in `tailwind.config.ts`. The key tokens:

| Token | Value | Usage |
|-------|-------|-------|
| `coral` | `#FF6F62` | Primary brand, CTAs, accents |
| `coral-shadow` | `#7A1F22` | Footer background |
| `honey` | `#E8B66A` | Arrow icons on coral backgrounds |
| `paper` | `#FCFAF6` | Page background |
| `ink` | `#1F1A18` | Body text |
| `font-serif` | Fraunces | Headings, italic display text |
| `font-sans` | Inter | Body copy, UI |

The `fraunces-soft` CSS class (in `globals.css`) applies `font-variation-settings: "SOFT" 100, "opsz" 144` for the italic display variant used on `<em>` elements inside headings.

---

## Search Console

After deploying:
1. Add the site in [Google Search Console](https://search.google.com/search-console)
2. Verify ownership via the HTML tag method (add to `app/layout.tsx` metadata)
3. Submit `https://www.auxenic.co.uk/sitemap.xml`

The sitemap is generated automatically at `/sitemap.xml` and includes all pages and blog posts.
