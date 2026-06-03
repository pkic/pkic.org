ALTER TABLE email_template_versions
ADD COLUMN message_type TEXT NOT NULL DEFAULT 'transactional' CHECK (message_type IN ('transactional', 'promotional'));

UPDATE email_template_versions
SET message_type = 'transactional'
WHERE message_type IS NULL;