import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';

const slugValido = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const textoOpcional = (max: number) =>
  z.string().trim().max(max).nullish();

const urlOpcional = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine(
    (value) => /^https?:\/\//i.test(value),
    'Usa una URL HTTP o HTTPS.',
  )
  .nullish();

export const server = {
  createPost: defineAction({
    accept: 'form',

    input: z.object({
      kind: z.enum(['news', 'tutorial']),
      title: z.string().trim().min(5).max(180),
      slug: z.string().trim().regex(slugValido),
      category: textoOpcional(80),
      image_url: urlOpcional,
      image_alt: textoOpcional(200),
      description: textoOpcional(350),
      body_markdown: textoOpcional(50000),
      seo_title: textoOpcional(180),
      seo_description: textoOpcional(200),
    }),

    handler: async (input) => {
      const user = await getUser();

      if (!user) {
        throw new ActionError({
          code: 'UNAUTHORIZED',
          message: 'Inicia sesión para crear una publicación.',
        });
      }

      if (!user.roles?.includes('admin')) {
        throw new ActionError({
          code: 'FORBIDDEN',
          message: 'Tu cuenta no tiene permiso para crear publicaciones.',
        });
      }

      const db = getDatabase();
      const metadataName = user.userMetadata?.full_name;

      const authorName =
        typeof metadataName === 'string' && metadataName.trim()
          ? metadataName.trim().slice(0, 120)
          : user.email?.split('@')[0] ?? 'Felix Place';

      const duplicate = await db.sql`
        SELECT id
        FROM posts
        WHERE kind = ${input.kind}
          AND slug = ${input.slug}
        LIMIT 1
      `;

      if (duplicate.length > 0) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: 'Ya existe una publicación de este tipo con ese slug.',
        });
      }

      await db.sql`
        INSERT INTO author_profiles (identity_user_id, display_name)
        VALUES (${user.id}, ${authorName})
        ON CONFLICT (identity_user_id)
        DO UPDATE SET
          display_name = EXCLUDED.display_name,
          updated_at = NOW()
      `;

      const [post] = await db.sql<{ id: string; slug: string }>`
        INSERT INTO posts (
          kind,
          title,
          slug,
          category,
          image_url,
          image_alt,
          description,
          body_markdown,
          author_identity_id,
          author_name,
          status,
          seo_title,
          seo_description
        )
        VALUES (
          ${input.kind},
          ${input.title},
          ${input.slug},
          ${input.category ?? null},
          ${input.image_url ?? null},
          ${input.image_alt ?? null},
          ${input.description ?? ''},
          ${input.body_markdown ?? ''},
          ${user.id},
          ${authorName},
          'draft',
          ${input.seo_title ?? null},
          ${input.seo_description ?? null}
        )
        RETURNING id, slug
      `;

      return { id: post.id, slug: post.slug };
    },
  }),

  publishPost: defineAction({
    accept: 'form',

    input: z.object({
      id: z.string().uuid(),
    }),

    handler: async ({ id }) => {
      const user = await getUser();

      if (!user) {
        throw new ActionError({
          code: 'UNAUTHORIZED',
          message: 'Inicia sesión para publicar.',
        });
      }

      if (!user.roles?.includes('admin')) {
        throw new ActionError({
          code: 'FORBIDDEN',
          message: 'Tu cuenta no tiene permiso para publicar.',
        });
      }

      const db = getDatabase();

      const [post] = await db.sql<{ id: string; title: string }>`
        UPDATE posts
        SET
          status = 'published',
          published_at = COALESCE(published_at, NOW()),
          updated_at = NOW()
        WHERE id = ${id}
          AND status IN ('draft', 'review')
        RETURNING id, title
      `;

      if (!post) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: 'No se encontró el borrador o ya fue publicado.',
        });
      }

      return { id: post.id, title: post.title };
    },
  }),

  submitComment: defineAction({
    accept: 'form',

    input: z.object({
      post_id: z.string().uuid(),
      display_name: z.string().trim().min(2).max(80),
      body: z.string().trim().min(2).max(2000),
      website: z.string().max(0).optional(),
    }),

    handler: async ({ post_id, display_name, body }) => {
      const db = getDatabase();

      const [post] = await db.sql<{ id: string }>`
        SELECT id
        FROM posts
        WHERE id = ${post_id}
          AND status = 'published'
        LIMIT 1
      `;

      if (!post) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: 'No se encontró esta publicación.',
        });
      }

      await db.sql`
        INSERT INTO comments (post_id, display_name, body)
        VALUES (${post_id}, ${display_name}, ${body})
      `;

      return { message: 'Tu comentario fue enviado para revisión.' };
    },
  }),

  moderateComment: defineAction({
    accept: 'form',

    input: z.object({
      comment_id: z.string().uuid(),
      status: z.enum(['approved', 'rejected']),
    }),

    handler: async ({ comment_id, status }) => {
      const user = await getUser();

      if (!user) {
        throw new ActionError({
          code: 'UNAUTHORIZED',
          message: 'Inicia sesión para moderar comentarios.',
        });
      }

      if (!user.roles?.includes('admin')) {
        throw new ActionError({
          code: 'FORBIDDEN',
          message: 'Tu cuenta no tiene permiso para moderar comentarios.',
        });
      }

      const db = getDatabase();
      const metadataName = user.userMetadata?.full_name;

      const moderatorName =
        typeof metadataName === 'string' && metadataName.trim()
          ? metadataName.trim().slice(0, 120)
          : user.email?.split('@')[0] ?? 'Administrador';

      await db.sql`
        INSERT INTO author_profiles (identity_user_id, display_name)
        VALUES (${user.id}, ${moderatorName})
        ON CONFLICT (identity_user_id)
        DO UPDATE SET
          display_name = EXCLUDED.display_name,
          updated_at = NOW()
      `;

      const [comment] = await db.sql<{ id: string }>`
        UPDATE comments
        SET
          status = ${status},
          moderator_identity_id = ${user.id},
          moderated_at = NOW()
        WHERE id = ${comment_id}
          AND status = 'pending'
        RETURNING id
      `;

      if (!comment) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: 'No se encontró el comentario pendiente.',
        });
      }

      return { id: comment.id, status };
    },
  }),
};