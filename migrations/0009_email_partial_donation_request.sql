-- Seed missing donation-request email partial used by shared templates.

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type,
   r2_object_key, checksum_sha256, status, created_by_user_id, created_at)
VALUES
  (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(6))),
    'partial_donation_request', 1,
    NULL,
    '**Help to keep the PKI Consortium Membership, Conferences, and Resources free**\n\nIf what we do is valuable to you or your organization, please consider a voluntary contribution — any amount helps us keep membership, conferences, and resources open to the widest possible audience.\n\n<div class="cta-secondary"><a href="{{baseUrl}}/donate/">Support the PKI Consortium &rarr;</a></div>\n\n<div class="notice notice-info">Contributions to the PKI Consortium are <strong>entirely voluntary</strong> and are not a ticket, fee, or payment for goods or services. The PKI Consortium is a <strong>501(c)(6) nonprofit business league</strong> — donations are <strong>not deductible as charitable contributions</strong> for U.S. federal income tax purposes. Consult your tax advisor regarding any applicable treatment in your jurisdiction.<br><br>Does your organization want to make a bigger impact? Sponsors directly fund free, open events for the global PKI and security community — <a href="{{baseUrl}}/sponsors/">explore sponsorship opportunities at pkic.org/sponsors/</a>.</div>',
    'markdown', NULL, '', 'active', NULL, datetime('now')
  );
