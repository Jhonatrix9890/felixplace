-- FelixPlace: base inicial para Netlify Database (PostgreSQL).
-- Solo guarda URLs de Postimages; no se cargan archivos de imagen en la base.
-- Netlify Identity gestiona contraseñas y sesiones; aquí solo guardamos perfiles.

CREATE TABLE author_profiles (
  identity_user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('news', 'tutorial')),
  title TEXT NOT NULL,
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  category TEXT,
  image_url TEXT,
  image_alt TEXT,
  description TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL DEFAULT '',
  author_identity_id TEXT REFERENCES author_profiles(identity_user_id) ON DELETE SET NULL,
  author_name TEXT NOT NULL DEFAULT 'Felix Place',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'scheduled', 'published', 'archived')),
  published_at TIMESTAMPTZ,
  seo_title TEXT,
  seo_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT posts_published_date CHECK (status <> 'published' OR published_at IS NOT NULL),
  CONSTRAINT posts_kind_slug_unique UNIQUE (kind, slug)
);

CREATE INDEX posts_public_listing_idx
  ON posts (kind, published_at DESC)
  WHERE status = 'published';

CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 80),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 2 AND 2000),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'spam')),
  moderator_identity_id TEXT REFERENCES author_profiles(identity_user_id) ON DELETE SET NULL,
  moderated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX comments_public_idx ON comments (post_id, created_at)
  WHERE status = 'approved';
CREATE INDEX comments_moderation_idx ON comments (created_at)
  WHERE status = 'pending';

CREATE TABLE affiliate_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE post_affiliate_products (
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES affiliate_products(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, product_id)
);

CREATE TABLE courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  summary TEXT NOT NULL DEFAULT '',
  description_markdown TEXT NOT NULL DEFAULT '',
  cover_image_url TEXT,
  instructor_identity_id TEXT REFERENCES author_profiles(identity_user_id) ON DELETE SET NULL,
  instructor_name TEXT NOT NULL DEFAULT 'Felix Place',
  level TEXT,
  language TEXT NOT NULL DEFAULT 'es',
  access_model TEXT NOT NULL DEFAULT 'free'
    CHECK (access_model IN ('free', 'paid', 'external')),
  price NUMERIC(10, 2) CHECK (price IS NULL OR price >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  checkout_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'scheduled', 'published', 'archived')),
  published_at TIMESTAMPTZ,
  seo_title TEXT,
  seo_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT courses_published_date CHECK (status <> 'published' OR published_at IS NOT NULL)
);

CREATE TABLE course_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (course_id, position)
);

CREATE TABLE course_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  body_markdown TEXT NOT NULL DEFAULT '',
  video_url TEXT,
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  visibility TEXT NOT NULL DEFAULT 'enrolled'
    CHECK (visibility IN ('preview', 'enrolled')),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (module_id, slug),
  UNIQUE (module_id, position)
);

CREATE TABLE editorial_audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_identity_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX editorial_audit_log_recent_idx ON editorial_audit_log (created_at DESC);
