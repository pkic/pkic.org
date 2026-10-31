-- Shared promotion text is an attribute of the agenda session. Its approval
-- and audit lifecycle already belongs to the agenda revision, not another entity.
ALTER TABLE event_agenda_occurrences ADD COLUMN promotion_copy_json TEXT
 CHECK(promotion_copy_json IS NULL OR json_valid(promotion_copy_json));
UPDATE event_agenda_occurrences
 SET promotion_copy_json=(SELECT copy_json FROM event_agenda_promotion_copy WHERE occurrence_id=event_agenda_occurrences.id)
 WHERE EXISTS(SELECT 1 FROM event_agenda_promotion_copy WHERE occurrence_id=event_agenda_occurrences.id);
DROP TABLE event_agenda_promotion_copy;

-- Referral traffic and registrations already have canonical attribution.
-- File-download counters are not needed to deliver or credit shared materials.
DROP TABLE event_agenda_promotion_downloads;

-- Personal presentation choices contain authored promotion text and resource
-- references only. Names, affiliations, portraits, schedule and sponsor data
-- continue to be resolved from their canonical records.
CREATE TABLE event_promotion_kits (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 occurrence_id TEXT REFERENCES event_agenda_occurrences(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 1,
 composition_json TEXT NOT NULL CHECK(json_valid(composition_json)),
 updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX event_promotion_kit_owner ON event_promotion_kits(event_id,user_id,COALESCE(occurrence_id,''));

-- One render queue serves session and attendee kits. The old session-only
-- queue cannot represent attendee work because its session reference is required.
-- Carry unfinished work forward below; do not retain an unused cache archive.
CREATE TABLE event_promotion_renders (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 occurrence_id TEXT REFERENCES event_agenda_occurrences(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL,
 fingerprint TEXT,
 format TEXT NOT NULL, origin TEXT NOT NULL, cache_key TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL, processing_token TEXT, lease_expires_at TEXT,
 last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, requested_at TEXT
);
CREATE INDEX event_promotion_render_due ON event_promotion_renders(status,next_attempt_at,lease_expires_at);
CREATE INDEX event_promotion_render_owner ON event_promotion_renders(event_id,user_id,occurrence_id,fingerprint,format);
-- Keep current kit progress bounded independently of completed or obsolete render history.
CREATE INDEX event_promotion_render_requested ON event_promotion_renders(event_id,user_id,occurrence_id,format,requested_at DESC);

-- A migrated request resolves its fingerprint and artifact location under the
-- normal worker lease. Completed cache entries are disposable; authored copy,
-- personal choices remain in their canonical records.
INSERT INTO event_promotion_renders
 (id,event_id,occurrence_id,user_id,revision,fingerprint,format,origin,cache_key,
  status,attempts,next_attempt_at,created_at,updated_at,requested_at)
SELECT id,event_id,occurrence_id,user_id,revision,NULL,format,origin,cache_key,
 'queued',attempts,
 CASE WHEN status='rendering' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE next_attempt_at END,
 created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'),created_at
FROM event_agenda_promotion_render_jobs
WHERE status IN ('queued','retrying','rendering');
DROP TABLE event_agenda_promotion_render_jobs;


-- A bulk request contains resource references only. The dispatcher prepares
-- bounded recipients for the existing render queue; it never renders a full
-- event inside an HTTP request.
CREATE TABLE event_promotion_batches (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 requested_by TEXT NOT NULL REFERENCES users(id),
 published_revision INTEGER NOT NULL,
 formats_json TEXT NOT NULL CHECK(json_valid(formats_json)),
 origin TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX event_promotion_batch_event ON event_promotion_batches(event_id,created_at);
CREATE TABLE event_promotion_batch_recipients (
 batch_id TEXT NOT NULL REFERENCES event_promotion_batches(id) ON DELETE CASCADE,
 occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'queued',
 fingerprint TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL,
 processing_token TEXT,
 lease_expires_at TEXT,
 last_error TEXT,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(batch_id,occurrence_id,user_id)
);
CREATE INDEX event_promotion_batch_due ON event_promotion_batch_recipients(status,next_attempt_at,lease_expires_at);


-- Pending email changes are requests, not ownership. Verified primary/alias uniqueness remains unchanged.
DROP INDEX uq_users_pending_email;
DROP INDEX idx_users_pending_email_unique;
DROP TRIGGER trg_users_pending_email_reservation_update;

-- A speaker invitation is mailed to one address, which may be an alias of an existing account.
-- Until the speaker accepts, the proposer sees that address rather than the account's primary one,
-- and only that mailbox may continue from the link without another proof. NULL on rows that predate it.
ALTER TABLE proposal_speakers ADD COLUMN invited_email TEXT;

-- Sentence-case the seeded membership application questions. A label an
-- administrator has already edited no longer matches and is left alone.

UPDATE form_fields
SET label = 'Role or job title'
WHERE form_id = (SELECT id FROM forms WHERE key = 'membership-application')
  AND key = 'job_title'
  AND label = 'Role / Job Title';

UPDATE form_fields
SET label = 'Organization website'
WHERE form_id = (SELECT id FROM forms WHERE key = 'membership-application')
  AND key = 'organization_website'
  AND label = 'Organization Website';

UPDATE form_fields
SET label = 'About yourself'
WHERE form_id = (SELECT id FROM forms WHERE key = 'membership-application')
  AND key = 'about_yourself'
  AND label = 'About Yourself';

UPDATE form_fields
SET label = 'About your organization'
WHERE form_id = (SELECT id FROM forms WHERE key = 'membership-application')
  AND key = 'about_organization'
  AND label = 'About Your Organization';

UPDATE form_fields
SET label = 'Why do you want to join the PKI Consortium?'
WHERE form_id = (SELECT id FROM forms WHERE key = 'membership-application')
  AND key = 'reason'
  AND label = 'Why do you want to join PKI Consortium?';

UPDATE form_fields
SET label = 'Working groups of interest'
WHERE form_id = (SELECT id FROM forms WHERE key = 'membership-application')
  AND key = 'working_groups'
  AND label = 'Working Groups of Interest';
