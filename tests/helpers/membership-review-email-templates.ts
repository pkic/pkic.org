import { DEFAULT_TEMPLATES } from "../../scripts/seed-email-templates.mjs";
import type { DatabaseLike } from "../../functions/_lib/types";
import { createTemplateVersion, activateTemplateVersion } from "../../functions/_lib/email/templates";

export async function seedMembershipReviewDigestTemplates(db: DatabaseLike): Promise<void> {
  for (const template of DEFAULT_TEMPLATES.filter(
    (item) => item.key === "membership-workflow-review-digest" || item.key.startsWith("partial_membership_review_"),
  )) {
    const existing = await db
      .prepare("SELECT id FROM email_template_versions WHERE template_key = ?")
      .bind(template.key)
      .first();
    if (existing) continue;
    const version = await createTemplateVersion(db, {
      templateKey: template.key,
      content: template.content,
      contentType: template.contentType,
      subjectTemplate: template.subjectTemplate,
      createdByUserId: null,
    });
    await activateTemplateVersion(db, { templateKey: template.key, version: version.version });
  }
  const layout = await createTemplateVersion(db, {
    templateKey: "email_layout",
    content: "{{{body_html}}}",
    createdByUserId: null,
  });
  await activateTemplateVersion(db, { templateKey: "email_layout", version: layout.version });
}
