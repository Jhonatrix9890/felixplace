import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = ({ url }) => {
  const contenido = `User-agent: *
Allow: /
Disallow: /admin/

Sitemap: ${url.origin}/sitemap.xml
`;

  return new Response(contenido, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Netlify-CDN-Cache-Control':
        'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
};