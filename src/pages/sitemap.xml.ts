import type { APIRoute } from 'astro';
import { getDatabase } from '@netlify/database';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const db = getDatabase();

  const posts = await db.sql<{
    kind: 'news' | 'tutorial';
    slug: string;
  }>`
    SELECT kind, slug
    FROM posts
    WHERE status = 'published'
    ORDER BY published_at DESC NULLS LAST, created_at DESC
  `;

  const paths = [
    '/',
    '/noticias',
    '/tutoriales',
    ...posts.map((post) =>
      post.kind === 'news'
        ? `/noticias/${post.slug}`
        : `/tutoriales/${post.slug}`,
    ),
  ];

  const urls = paths
    .map((path) => {
      const loc = new URL(path, url.origin).toString();
      return `  <url><loc>${loc}</loc></url>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Netlify-CDN-Cache-Control':
        'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
};