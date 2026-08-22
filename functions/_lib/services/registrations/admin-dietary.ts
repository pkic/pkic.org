import { all } from "../../db/queries";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import type { DatabaseLike } from "../../types";

interface DietaryCountRow {
  dietary_value: string;
  count: number;
}

/**
 * Aggregates the event-wide dietary summary in D1 instead of loading every
 * registered answer blob into Worker memory. The DISTINCT registration/value
 * set preserves the previous per-registration de-duplication semantics when
 * the same choice appears in both a form-specific key and a legacy fallback
 * key.
 */
export async function getDietaryCounts(
  db: DatabaseLike,
  eventId: string,
  dietaryFieldKeys: readonly string[],
): Promise<Record<string, number>> {
  const fieldFilter = buildD1JsonMembershipFilter("answer.key", dietaryFieldKeys);
  const rows = await all<DietaryCountRow>(
    db,
    `WITH dietary_answers AS (
           SELECT r.id AS registration_id,
                  answer.type AS answer_type,
                  answer.value AS answer_value
           FROM registrations r
           CROSS JOIN json_each(
             CASE WHEN json_valid(r.custom_answers_json) THEN r.custom_answers_json ELSE '{}' END
           ) AS answer
           WHERE r.event_id = ?
             AND r.status = 'registered'
             AND r.custom_answers_json IS NOT NULL
             AND ${fieldFilter.sql}
         ),
         raw_values AS (
           SELECT registration_id, item.type AS value_type, item.value AS value
           FROM dietary_answers
           CROSS JOIN json_each(
             CASE
               WHEN answer_type = 'array'
                 AND json_valid(answer_value)
                 AND json_type(answer_value) = 'array' THEN answer_value
               WHEN answer_type = 'text' THEN json_array(answer_value)
               ELSE '[]'
             END
           ) AS item
         ),
         normalized_values AS (
           SELECT registration_id,
                  CASE value_type
                    WHEN 'null' THEN 'null'
                    WHEN 'true' THEN 'true'
                    WHEN 'false' THEN 'false'
                    WHEN 'object' THEN '[object Object]'
                    WHEN 'array' THEN json(value)
                    ELSE TRIM(CAST(value AS TEXT))
                  END AS dietary_value
           FROM raw_values
         ),
         distinct_values AS (
           SELECT DISTINCT registration_id, dietary_value
           FROM normalized_values
           WHERE dietary_value IS NOT NULL AND dietary_value <> ''
         )
         SELECT dietary_value, COUNT(*) AS count
         FROM distinct_values
         GROUP BY dietary_value
         ORDER BY dietary_value ASC`,
    [eventId, ...fieldFilter.bindings],
  );

  return Object.fromEntries(rows.map((row) => [row.dietary_value, Number(row.count)]));
}
