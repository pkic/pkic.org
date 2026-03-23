-- Seed missing email layout template required by outbox rendering.

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type,
   r2_object_key, checksum_sha256, status, created_by_user_id, created_at)
VALUES
  (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(6))),
    'email_layout', 1,
    NULL,
    '<!doctype html><html><body>{{{body_html}}}</body></html>',
    'html', NULL, '', 'active', NULL, datetime('now')
  );
