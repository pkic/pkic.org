/** Canonical agenda credit display expression; the caller joins users as user. */
export const agendaSpeakerDisplayNameSql =
  "COALESCE(NULLIF(user.preferred_name,''),NULLIF(TRIM(COALESCE(user.first_name,'') || ' ' || COALESCE(user.last_name,'')),''),'Speaker')";
