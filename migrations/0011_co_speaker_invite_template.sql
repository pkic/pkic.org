-- Seed missing co-speaker invite template for fresh test databases.

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type,
   r2_object_key, checksum_sha256, status, created_by_user_id, created_at)
VALUES
  (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(6))),
    'co_speaker_invite', 1,
    'You have been added as a speaker — {{eventName}}',
    '{{#if firstName}}Dear {{firstName}},{{else}}Dear Speaker,{{/if}}\n\nYou have been invited to participate as a speaker for **{{eventName}}**.\n\n> **Proposal:** {{proposalTitle}}\n\nPlease confirm your participation:\n\n[Review proposal and respond]({{manageUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now')
  );
