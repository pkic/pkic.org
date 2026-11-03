import type { DatabaseLike } from "../../functions/_lib/types";
import { nowIso } from "../../functions/_lib/utils/time";

/** A current or historical form placed on the synthetic campaign event. */
export async function seedCampaignForm(db: DatabaseLike, eventId: string, fieldKey: string, active = true) {
  const formId = crypto.randomUUID(),
    fieldId = crypto.randomUUID(),
    placementId = crypto.randomUUID();
  const at = nowIso();
  await db.batch([
    db
      .prepare(`INSERT INTO forms (id,key,scope_type,scope_ref,purpose,status,title,created_at,updated_at)
      VALUES (?,?,'event',?,'event_registration','active','Campaign answers',?,?)`)
      .bind(formId, `campaign-${formId}`, eventId, at, at),
    db
      .prepare(`INSERT INTO form_fields (id,form_id,key,label,field_type,required,sort_order,created_at)
      VALUES (?,?,?,'Dietary needs','text',0,0,?)`)
      .bind(fieldId, formId, fieldKey, at),
    db
      .prepare(`INSERT INTO form_placements (id,form_id,context_type,context_ref,audience,active,created_at,updated_at)
      VALUES (?,?,'event',?,'attendee',?,?,?)`)
      .bind(placementId, formId, eventId, active ? 1 : 0, at, at),
  ]);
  return { formId, fieldId, placementId, fieldKey };
}

/** A normalized historical response retains the definition the person actually answered. */
export async function attachCampaignFormResponse(
  db: DatabaseLike,
  form: Awaited<ReturnType<typeof seedCampaignForm>>,
  registrationId: string,
  userId: string,
  value: string,
) {
  const submissionId = crypto.randomUUID(),
    at = nowIso();
  await db.batch([
    db.prepare("UPDATE registrations SET form_placement_id=? WHERE id=?").bind(form.placementId, registrationId),
    db
      .prepare(`INSERT INTO form_submissions
      (id,form_id,placement_id,submitted_by_user_id,context_type,context_ref,status,submitted_at)
      VALUES (?,?,?,?,'registration',?,'submitted',?)`)
      .bind(submissionId, form.formId, form.placementId, userId, registrationId, at),
    db
      .prepare(`INSERT INTO form_submission_answers (id,submission_id,field_id,field_key,data_json,created_at)
      VALUES (?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), submissionId, form.fieldId, form.fieldKey, JSON.stringify(value), at),
  ]);
}
