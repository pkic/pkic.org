/**
 * The shared person-name rule (`assets/shared/person-display.ts`) as D1 SQL:
 * the preferred name stands in for the first name, and the last name follows.
 * `alias` is a joined `users` row.
 */

/** The name a person goes by, or NULL when the record holds no name at all. */
export function personNameSql(alias: string): string {
  return `NULLIF(TRIM(COALESCE(NULLIF(TRIM(${alias}.preferred_name),''),${alias}.first_name,'') || ' ' || COALESCE(${alias}.last_name,'')),'')`;
}

/** The name a person goes by, else the literal `fallback`. */
export function personDisplayNameSql(alias: string, fallback: string): string {
  return `COALESCE(${personNameSql(alias)},'${fallback.replace(/'/g, "''")}')`;
}
