import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';

const slugValido = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const valorVacioComoNulo = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

const textoOpcional = (max: number) =>
  z.preprocess(
    valorVacioComoNulo,
    z.string().trim().max(max).nullish(),
  );

const urlOpcional = z.preprocess(
  valorVacioComoNulo,
  z
    .string()
    .trim()
    .max(2048)
    .url()
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'Usa una URL HTTP o HTTPS.')
    .nullish(),
);

const youtubeUrlOpcional = z.preprocess(
  valorVacioComoNulo,
  z
    .string()
    .trim()
    .max(2048)
    .url()
    .refine((value) => {
      try {
        const url = new URL(value);
        const dominiosPermitidos = [
          'youtube.com',
          'www.youtube.com',
          'm.youtube.com',
          'youtu.be',
        ];

        return (
          url.protocol === 'https:' &&
          dominiosPermitidos.includes(url.hostname.toLowerCase())
        );
      } catch {
        return false;
      }
    }, 'Usa un enlace HTTPS válido de YouTube.')
    .nullish(),
);

const camposPublicacion = {
  kind: z.enum(['news', 'tutorial']),
  title: z.string().trim().min(5).max(180),
  slug: z
    .string()
    .trim()
    .max(180)
    .regex(slugValido, 'Escribe un slug válido.'),
  category: textoOpcional(80),
  image_url: urlOpcional,
  video_url: youtubeUrlOpcional,
  image_alt: textoOpcional(200),
  description: textoOpcional(350),
  body_markdown: textoOpcional(50000),
  seo_title: textoOpcional(180),
  seo_description: textoOpcional(200),
};

const tienePermisoEditorial = (roles: readonly string[] | undefined) =>
  roles?.some((role) => role === 'admin' || role === 'editor') ?? false;

export const server = {

  unpublishCourse: defineAction({
    accept: 'form',
    input: z.object({
      id: z.string().uuid(),
    }),

    handler: async ({ id }) => {
      const user = await getUser();

      if (!user) {
        throw new ActionError({
          code: 'UNAUTHORIZED',
          message: 'Inicia sesión para administrar cursos.',
        });
      }

      if (!user.roles?.includes('admin')) {
        throw new ActionError({
          code: 'FORBIDDEN',
          message: 'Solo una cuenta administradora puede retirar cursos.',
        });
      }

      const db = getDatabase();

      const [course] = await db.sql<{ id: string; title: string }>`
        UPDATE courses
        SET
          status = 'draft',
          published_at = NULL,
          updated_at = NOW()
        WHERE id = ${id}
          AND status = 'published'
        RETURNING id, title
      `;

      if (!course) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: 'No se encontró el curso publicado.',
        });
      }

      return { id: course.id, title: course.title };
    },
  }),

  createPost: defineAction({
    accept: 'form',

    input: z.object(camposPublicacion).superRefine((input, ctx) => {
      if (input.kind === 'tutorial' && !input.video_url) {
        ctx.addIssue({
          code: 'custom',
          path: ['video_url'],
          message: 'Agrega el enlace de YouTube del tutorial.',
        });
      }
    }),

    handler: async (input) => {
      const user = await getUser();

      if (!user) {
        throw new ActionError({
          code: 'UNAUTHORIZED',
          message: 'Inicia sesión para crear una publicación.',
        });
      }

      if (!tienePermisoEditorial(user.roles)) {
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
          video_url,
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
          ${input.kind === 'news' ? (input.image_url ?? null) : null},
          ${input.kind === 'tutorial' ? (input.video_url ?? null) : null},
          ${input.kind === 'news' ? (input.image_alt ?? null) : null},
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

  updatePost: defineAction({
    accept: 'form',

    input: z
      .object({
        id: z.string().uuid(),
        ...camposPublicacion,
      })
      .superRefine((input, ctx) => {
        if (input.kind === 'tutorial' && !input.video_url) {
          ctx.addIssue({
            code: 'custom',
            path: ['video_url'],
            message: 'Agrega el enlace de YouTube del tutorial.',
          });
        }
      }),

    handler: async ({ id, ...input }) => {
      const user = await getUser();

      if (!user) {
        throw new ActionError({
          code: 'UNAUTHORIZED',
          message: 'Inicia sesión para editar una publicación.',
        });
      }

      if (!tienePermisoEditorial(user.roles)) {
        throw new ActionError({
          code: 'FORBIDDEN',
          message: 'Tu cuenta no tiene permiso para editar publicaciones.',
        });
      }

      const db = getDatabase();

      const [existingPost] = await db.sql<{
        id: string;
        slug: string;
        status: string;
        kind: 'news' | 'tutorial';
      }>`
        SELECT id, slug, status, kind
        FROM posts
        WHERE id = ${id}
        LIMIT 1
      `;

      if (!existingPost) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: 'No se encontró la publicación que deseas editar.',
        });
      }

      if (
        existingPost.status === 'published' &&
        (existingPost.slug !== input.slug ||
          existingPost.kind !== input.kind)
      ) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message:
            'No se puede cambiar el slug ni el tipo de una publicación ya publicada.',
        });
      }

      const duplicate = await db.sql`
        SELECT id
        FROM posts
        WHERE kind = ${input.kind}
          AND slug = ${input.slug}
          AND id <> ${id}
        LIMIT 1
      `;

      if (duplicate.length > 0) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: 'Ya existe otra publicación de este tipo con ese slug.',
        });
      }

      const [post] = await db.sql<{ id: string; slug: string }>`
        UPDATE posts
        SET
          kind = ${input.kind},
          title = ${input.title},
          slug = ${input.slug},
          category = ${input.category ?? null},
          image_url = ${
            input.kind === 'news' ? (input.image_url ?? null) : null
          },
          video_url = ${
            input.kind === 'tutorial' ? (input.video_url ?? null) : null
          },
          image_alt = ${
            input.kind === 'news' ? (input.image_alt ?? null) : null
          },
          description = ${input.description ?? ''},
          body_markdown = ${input.body_markdown ?? ''},
          seo_title = ${input.seo_title ?? null},
          seo_description = ${input.seo_description ?? null},
          updated_at = NOW()
        WHERE id = ${id}
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

      if (!tienePermisoEditorial(user.roles)) {
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
          AND (kind <> 'tutorial' OR video_url IS NOT NULL)
        RETURNING id, title
      `;

      if (!post) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message:
            'No se encontró un borrador listo para publicar. Verifica que el tutorial tenga un enlace de YouTube.',
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
      website: z.string().trim().max(200).optional(),
    }),

    handler: async ({ post_id, display_name, body, website }) => {
      if (website) {
        return { message: 'Tu comentario fue enviado para revisión.' };
      }

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

  createCourse: defineAction({
    accept: 'form',

    input: z
      .object({
        title: z.string().trim().min(5).max(180),
        slug: z
          .string()
          .trim()
          .max(180)
          .regex(slugValido, 'Escribe un slug válido.'),
        summary: z.string().trim().min(10).max(350),
        description_markdown: textoOpcional(50000),
        cover_image_url: urlOpcional,
        level: textoOpcional(40),
        language: z.string().trim().min(2).max(10).default('es'),
        access_model: z.enum(['free', 'paid', 'external']),
        price: z.preprocess(
          valorVacioComoNulo,
          z.coerce.number().min(0).max(100000).nullish(),
        ),
        currency: z
          .string()
          .trim()
          .length(3)
          .default('USD')
          .transform((currency) => currency.toUpperCase()),
        checkout_url: urlOpcional,
        seo_title: textoOpcional(180),
        seo_description: textoOpcional(200),
      })
      .superRefine((input, ctx) => {
        if (input.access_model === 'paid' && input.price == null) {
          ctx.addIssue({
            code: 'custom',
            path: ['price'],
            message: 'Indica el precio del curso.',
          });
        }

        if (input.access_model === 'external' && !input.checkout_url) {
          ctx.addIssue({
            code: 'custom',
            path: ['checkout_url'],
            message: 'Agrega el enlace externo donde se ofrece el curso.',
          });
        }
      }),

    handler: async (input) => {
      const user = await getUser();

      if (!user) {
        throw new ActionError({
          code: 'UNAUTHORIZED',
          message: 'Inicia sesión para crear un curso.',
        });
      }

      if (!tienePermisoEditorial(user.roles)) {
        throw new ActionError({
          code: 'FORBIDDEN',
          message: 'Tu cuenta no tiene permiso para crear cursos.',
        });
      }

      const db = getDatabase();

      const duplicate = await db.sql`
        SELECT id
        FROM courses
        WHERE slug = ${input.slug}
        LIMIT 1
      `;

      if (duplicate.length > 0) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: 'Ya existe un curso con ese slug.',
        });
      }

      const metadataName = user.userMetadata?.full_name;
      const instructorName =
        typeof metadataName === 'string' && metadataName.trim()
          ? metadataName.trim().slice(0, 120)
          : user.email?.split('@')[0] ?? 'Felix Place';

      await db.sql`
        INSERT INTO author_profiles (identity_user_id, display_name)
        VALUES (${user.id}, ${instructorName})
        ON CONFLICT (identity_user_id)
        DO UPDATE SET
          display_name = EXCLUDED.display_name,
          updated_at = NOW()
      `;

      const [course] = await db.sql<{ id: string; slug: string }>`
        INSERT INTO courses (
          title,
          slug,
          summary,
          description_markdown,
          cover_image_url,
          instructor_identity_id,
          instructor_name,
          level,
          language,
          access_model,
          price,
          currency,
          checkout_url,
          status,
          seo_title,
          seo_description
        )
        VALUES (
          ${input.title},
          ${input.slug},
          ${input.summary},
          ${input.description_markdown ?? ''},
          ${input.cover_image_url ?? null},
          ${user.id},
          ${instructorName},
          ${input.level ?? null},
          ${input.language},
          ${input.access_model},
          ${input.access_model === 'free' ? null : (input.price ?? null)},
          ${input.currency},
          ${input.checkout_url ?? null},
          'draft',
          ${input.seo_title ?? null},
          ${input.seo_description ?? null}
        )
        RETURNING id, slug
      `;

      return { id: course.id, slug: course.slug };
    },
  }),

  publishCourse: defineAction({
    accept: 'form',

    input: z.object({
      id: z.string().uuid(),
    }),

    handler: async ({ id }) => {
      const user = await getUser();

      if (!user) {
        throw new ActionError({
          code: 'UNAUTHORIZED',
          message: 'Inicia sesión para publicar un curso.',
        });
      }

      if (!tienePermisoEditorial(user.roles)) {
        throw new ActionError({
          code: 'FORBIDDEN',
          message: 'Tu cuenta no tiene permiso para publicar cursos.',
        });
      }

      const db = getDatabase();

      const [course] = await db.sql<{ id: string; title: string }>`
        UPDATE courses
        SET
          status = 'published',
          published_at = COALESCE(published_at, NOW()),
          updated_at = NOW()
        WHERE id = ${id}
          AND status IN ('draft', 'review')
          AND (
            (access_model = 'free')
            OR (access_model = 'paid' AND price IS NOT NULL)
            OR (access_model = 'external' AND checkout_url IS NOT NULL)
          )
        RETURNING id, title
      `;

      if (!course) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message:
            'No se encontró un borrador listo para publicar. Verifica que los cursos de pago tengan precio y los externos tengan un enlace.',
        });
      }

      return { id: course.id, title: course.title };
    },
  }),

  submitContactMessage: defineAction({
    accept: 'form',

    input: z.object({
      message_type: z.enum(['contact', 'suggestion', 'correction']),
      name: z.string().trim().min(2).max(100),
      email: z
        .string()
        .trim()
        .email()
        .max(254)
        .transform((email) => email.toLowerCase()),
      subject: z.string().trim().min(3).max(150),
      message: z.string().trim().min(10).max(5000),
      privacy_consent: z.literal('on'),
      website: z.string().trim().max(200).optional(),
    }),

    handler: async ({
      message_type,
      name,
      email,
      subject,
      message,
      website,
    }) => {
      if (website) {
        return {
          message: 'Recibimos tu mensaje. Gracias por escribirnos.',
        };
      }

      const db = getDatabase();

      await db.sql`
        INSERT INTO contact_messages (
          message_type,
          name,
          email,
          subject,
          message,
          privacy_consent
        )
        VALUES (
          ${message_type},
          ${name},
          ${email},
          ${subject},
          ${message},
          TRUE
        )
      `;

      return {
        message: 'Recibimos tu mensaje. Gracias por escribirnos.',
      };
    },
  }),

  updateContactMessageStatus: defineAction({
    accept: 'form',

    input: z.object({
      id: z.string().uuid(),
      status: z.enum(['read', 'answered', 'spam']),
    }),

    handler: async ({ id, status }) => {
      const user = await getUser();

      if (!user) {
        throw new ActionError({
          code: 'UNAUTHORIZED',
          message: 'Inicia sesión para administrar los mensajes.',
        });
      }

      if (!user.roles?.includes('admin')) {
        throw new ActionError({
          code: 'FORBIDDEN',
          message:
            'Solo una cuenta administradora puede administrar mensajes.',
        });
      }

      const db = getDatabase();

      const [contactMessage] = await db.sql<{ id: string }>`
        UPDATE contact_messages
        SET
          status = ${status},
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING id
      `;

      if (!contactMessage) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: 'No se encontró el mensaje.',
        });
      }

      return { id: contactMessage.id, status };
    },
  }),
};