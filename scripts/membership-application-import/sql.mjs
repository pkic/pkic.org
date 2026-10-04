import { createHash, randomBytes } from "node:crypto";
import { sqlString as quote } from "../lib/sql.mjs";
import { unresolvedReason } from "./manifest.mjs";

/** Stable record IDs provide replay safety without a permanent migration table or column. */
export function sourceId(source, kind = "application") {
  return createHash("sha256").update(`pkic/members\0${source.issue.id}\0${kind}`).digest("hex").slice(0, 32);
}

export function confirmationQuery(source) {
  const id = quote(sourceId(source));
  return `SELECT ma.id, EXISTS(SELECT 1 FROM application_communications c WHERE c.id = ${quote(sourceId(source, "source:0"))} AND c.application_id = ma.id) AS source_note FROM member_applications ma WHERE ma.id = ${id}`;
}

function sourceNotes(entry) {
  const { source, mapping } = entry;
  const issue = source.issue;
  const { body: originalBody, ...metadata } = issue;
  const notes = [
    {
      key: "source",
      at: issue.created_at,
      text: `Original application: ${issue.html_url}\n${issue.title}\n\n${originalBody ?? ""}\n\nSource labels: ${issue.labels.map((label) => label.name).join(", ")}\nSource closure: ${issue.closed_at}\nReviewed outcome evidence: ${mapping.mappingReason}\n\nOriginal source metadata:\n${JSON.stringify(metadata, null, 2)}`,
    },
  ];
  for (const event of source.comments)
    notes.push({
      key: `comment:${event.id}`,
      at: event.created_at,
      text: `Original GitHub comment by ${event.user?.login ?? event.actor?.login ?? "unknown author"}\n${issue.html_url}#issuecomment-${event.id}\n\n${event.body ?? ""}`,
    });
  for (const event of source.timeline.filter((event) => event.event !== "commented"))
    notes.push({
      key: `event:${event.id}`,
      at: event.created_at,
      text: `Original GitHub event: ${event.event ?? "unknown"}\nSource: ${issue.html_url}\n${JSON.stringify(event, null, 2)}`,
    });
  return notes.flatMap((note) => {
    const characters = Array.from(note.text);
    const parts = [];
    for (let offset = 0; offset < characters.length; offset += 8000)
      parts.push({
        id: sourceId(source, `${note.key}:${offset / 8000}`),
        at: note.at,
        body: `Source evidence from ${note.at} (part ${offset / 8000 + 1}):\n${characters.slice(offset, offset + 8000).join("")}`,
      });
    return parts;
  });
}

/** One file per source; every dependent insert is gated by the preceding insert's changes(). */
export function applicationBackfillSql(manifest, entry, now = new Date().toISOString()) {
  const unsupported = unresolvedReason(entry);
  if (unsupported) throw new Error(`Unresolved source: ${unsupported}`);
  const { source, mapping: m } = entry;
  const id = quote(sourceId(source));
  const actor = quote(manifest.actorUserId);
  const guard = [
    `EXISTS(SELECT 1 FROM users WHERE id = ${actor} AND active = 1 AND pii_redacted_at IS NULL)`,
    `EXISTS(SELECT 1 FROM membership_categories WHERE code = ${quote(m.membershipCategory)} AND ((is_individual = 1 AND ${quote(m.organizationName)} IS NULL) OR (is_individual = 0 AND ${quote(m.organizationName)} IS NOT NULL)))`,
    `(${quote(m.applicantUserId)} IS NULL OR EXISTS(SELECT 1 FROM users WHERE id = ${quote(m.applicantUserId)} AND normalized_email = ${quote(m.applicantEmail)} AND pii_redacted_at IS NULL))`,
    `NOT EXISTS(SELECT 1 FROM member_applications WHERE lower(applicant_email) = ${quote(m.applicantEmail)} AND created_at = ${quote(source.issue.created_at)} AND id <> ${id})`,
  ].join(" AND ");
  const values = [
    m.applicantUserId,
    m.applicantEmail,
    m.applicantName,
    m.organizationName,
    m.membershipCategory,
    m.outcome,
    m.decisionAt,
    randomBytes(32).toString("hex"),
    source.issue.created_at,
    now,
  ].map(quote);
  values.splice(
    4,
    0,
    `CASE WHEN (SELECT is_individual FROM membership_categories WHERE code = ${quote(m.membershipCategory)}) = 1 THEN NULL ELSE ${quote(m.applicantEmail.split("@")[1])} END`,
  );
  const statements = [
    `INSERT INTO member_applications (id, applicant_user_id, applicant_email, applicant_name, organization_name, organization_domain, membership_category, stage, stage_entered_at, manage_token_hash, created_at, updated_at)
SELECT CASE WHEN ${guard} THEN ${id} ELSE NULL END, ${values.join(", ")}
WHERE NOT EXISTS(SELECT 1 FROM member_applications WHERE id = ${id});`,
  ];
  for (const note of sourceNotes(entry))
    statements.push(
      `INSERT INTO application_communications (id, application_id, kind, actor_user_id, body, created_at)
SELECT ${quote(note.id)}, ${id}, 'note', ${actor}, ${quote(note.body)}, ${quote(now)} WHERE changes() = 1;`,
    );
  statements.push(`INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at)
SELECT ${quote(sourceId(source, "audit"))}, 'admin', ${actor}, 'member_application_recorded', 'member_application', ${id}, ${quote(JSON.stringify({ source: { from: null, to: source.issue.html_url } }))}, ${quote(now)} WHERE changes() = 1;`);
  if (statements.some((statement) => Buffer.byteLength(statement) > 90_000 || statement.includes("\0")))
    throw new Error("Source evidence exceeds safe SQL limits; leave this source unresolved");
  return statements.join("\n");
}
