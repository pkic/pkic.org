/** Country comes from the registration's typed country answer, never an inferred IP or employer address. */
export const REGISTRATION_COUNTRY_SQL = `(SELECT UPPER(json_extract(answer.data_json,'$'))
  FROM form_submissions submission
  JOIN form_submission_answers answer ON answer.submission_id=submission.id
  JOIN forms definition ON definition.id=submission.form_id AND definition.purpose='event_registration'
  JOIN form_fields field ON field.id=answer.field_id AND field.form_id=submission.form_id
  WHERE submission.context_type='registration' AND submission.context_ref=r.id AND submission.status='submitted'
    AND (definition.scope_type='global' OR (definition.scope_type='event' AND definition.scope_ref=r.event_id))
    AND json_extract(field.validation_json,'$.format')='iso_country'
    AND json_type(answer.data_json,'$')='text'
  ORDER BY submission.submitted_at DESC,field.sort_order,field.key LIMIT 1)`;
