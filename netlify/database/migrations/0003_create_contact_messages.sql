CREATE TABLE contact_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_type TEXT NOT NULL
    CHECK (message_type IN ('contact', 'suggestion', 'correction')),
  name TEXT NOT NULL
    CHECK (char_length(name) BETWEEN 2 AND 100),
  email TEXT NOT NULL
    CHECK (char_length(email) BETWEEN 3 AND 254),
  subject TEXT NOT NULL
    CHECK (char_length(subject) BETWEEN 3 AND 150),
  message TEXT NOT NULL
    CHECK (char_length(message) BETWEEN 10 AND 5000),
  privacy_consent BOOLEAN NOT NULL
    CHECK (privacy_consent = TRUE),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'read', 'answered', 'spam')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX contact_messages_review_idx
  ON contact_messages (status, created_at DESC);