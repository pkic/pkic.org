/** The canonical person display expression: preferred name, else first and last name, else `fallback`. */
export function personDisplayNameSql(alias: string, fallback: string): string {
  return `COALESCE(NULLIF(${alias}.preferred_name,''),NULLIF(TRIM(COALESCE(${alias}.first_name,'') || ' ' || COALESCE(${alias}.last_name,'')),''),'${fallback.replace(/'/g, "''")}')`;
}

/** Canonical agenda credit display expression; the caller joins users as user. */
export const agendaSpeakerDisplayNameSql = personDisplayNameSql("user", "Speaker");
