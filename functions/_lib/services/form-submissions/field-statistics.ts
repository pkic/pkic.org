import { batchFirst, batchRows } from "../../db/pagination";
import { parseJsonSafe } from "../../utils/json";
import { parseFormFieldOptions } from "../../../../assets/shared/schemas/form-field-rules";
import { adminFormSubmissionStatsResponseSchema } from "../../../../assets/shared/schemas/admin-forms";
import type { DatabaseLike } from "../../types";
import type { FieldRow, FieldStatPayload, GetFormSubmissionStatsParams, GetFormSubmissionStatsResult } from "./types";
import { parseFormFieldOptionSource, resolveFormFieldOptionCatalogs } from "../forms/read";
import {
  countSubmissionPopulation,
  resolveFormSubmissionPopulation,
  selectFromSubmissionPopulation,
} from "./population-query";

const MAX_STATS_ENTRIES_PER_FIELD = 50;

interface AggregatedStatRow {
  field_key: string;
  label: string;
  count: number;
  total_answers: number;
  unique_answers: number;
}

function buildFieldStatistics(
  fields: FieldRow[],
  rows: AggregatedStatRow[],
  catalogs: Awaited<ReturnType<typeof resolveFormFieldOptionCatalogs>>,
): FieldStatPayload[] {
  const optionLabelsByField = new Map(
    fields.map((field) => {
      const source = parseFormFieldOptionSource(field.option_source);
      const options = source
        ? (catalogs[source] ?? [])
        : parseFormFieldOptions(parseJsonSafe<unknown>(field.options_json, null));
      return [field.key, new Map<string, string>(options.map((option) => [option.value, option.label]))] as const;
    }),
  );
  const rowsByField = new Map<string, AggregatedStatRow[]>();
  for (const row of rows) {
    const fieldRows = rowsByField.get(row.field_key) ?? [];
    fieldRows.push(row);
    rowsByField.set(row.field_key, fieldRows);
  }

  return Array.from(rowsByField.entries()).map(([fieldKey, fieldRows]) => {
    const merged = new Map<string, number>();
    for (const row of fieldRows) {
      const label = optionLabelsByField.get(fieldKey)?.get(row.label) ?? row.label;
      merged.set(label, (merged.get(label) ?? 0) + Number(row.count));
    }
    const maxCount = Math.max(1, ...merged.values());
    const countedValues = Array.from(merged.values()).reduce((sum, count) => sum + count, 0) || 1;
    const entries = Array.from(merged.entries())
      .map(([label, count]) => ({
        label,
        count,
        percent: Math.round((count / countedValues) * 100),
        weight: count / maxCount,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    return {
      fieldKey,
      totalAnswers: Number(fieldRows[0]?.total_answers ?? 0),
      uniqueAnswers: Number(fieldRows[0]?.unique_answers ?? entries.length),
      entries,
    };
  });
}

const AGGREGATED_STATISTICS_SELECT = `normalized_answers AS (
    SELECT m.id AS submission_id, COALESCE(ff.key, a.field_key) AS field_key, a.data_json
    FROM merged m
    JOIN form_submission_answers a ON m.source = 'submission' AND a.submission_id = m.source_id
    LEFT JOIN form_fields ff ON ff.id = a.field_id
    UNION ALL
    SELECT m.id AS submission_id, je.key AS field_key,
           CASE je.type
             WHEN 'array' THEN json(je.value)
             WHEN 'object' THEN json(je.value)
             WHEN 'true' THEN 'true'
             WHEN 'false' THEN 'false'
             WHEN 'null' THEN 'null'
             ELSE json_quote(je.value)
           END AS data_json
    FROM merged m
    CROSS JOIN json_each(
      CASE WHEN json_valid(m.answers_json) THEN m.answers_json ELSE '{}' END
    ) je
    WHERE m.source IN ('registration', 'proposal')
  ),
  expanded_raw AS (
    SELECT a.submission_id, a.field_key, value.type AS value_type, value.value AS value
    FROM normalized_answers a
    CROSS JOIN json_each(
      CASE
        WHEN json_valid(a.data_json) AND json_type(a.data_json) = 'array' THEN a.data_json
        WHEN json_valid(a.data_json) THEN json_array(json(a.data_json))
        ELSE json_array(a.data_json)
      END
    ) value
  ),
  labeled AS (
    SELECT submission_id, field_key,
           CASE value_type
             WHEN 'true' THEN 'Yes'
             WHEN 'false' THEN 'No'
             WHEN 'null' THEN NULL
             WHEN 'array' THEN json(value)
             WHEN 'object' THEN json(value)
             ELSE TRIM(CAST(value AS TEXT))
           END AS label
    FROM expanded_raw
  ),
  entry_counts AS (
    SELECT field_key, label, COUNT(DISTINCT submission_id) AS count
    FROM labeled
    WHERE label IS NOT NULL AND label <> ''
    GROUP BY field_key, label
  ),
  field_totals AS (
    SELECT field_key, COUNT(DISTINCT submission_id) AS total_answers
    FROM labeled
    WHERE label IS NOT NULL AND label <> ''
    GROUP BY field_key
  ),
  ranked AS (
    SELECT e.field_key, e.label, e.count, t.total_answers,
           COUNT(*) OVER (PARTITION BY e.field_key) AS unique_answers,
           ROW_NUMBER() OVER (PARTITION BY e.field_key ORDER BY e.count DESC, e.label ASC) AS entry_rank
    FROM entry_counts e
    JOIN field_totals t ON t.field_key = e.field_key
  )
  SELECT field_key, SUBSTR(label, 1, 500) AS label, count, total_answers, unique_answers
  FROM ranked
  WHERE entry_rank <= ?
  ORDER BY field_key ASC, entry_rank ASC`;

export async function getFormSubmissionStats(
  db: DatabaseLike,
  params: GetFormSubmissionStatsParams,
): Promise<GetFormSubmissionStatsResult> {
  const population = await resolveFormSubmissionPopulation(db, params);
  const countQuery = countSubmissionPopulation(population);
  const statisticsQuery = selectFromSubmissionPopulation(population, `, ${AGGREGATED_STATISTICS_SELECT}`, [
    MAX_STATS_ENTRIES_PER_FIELD,
  ]);
  const [fieldsResult, countResult, statisticsResult] = await db.batch([
    db
      .prepare(
        `SELECT id, key, options_json, option_source
         FROM form_fields
         WHERE form_id = ?
         ORDER BY sort_order ASC, key ASC`,
      )
      .bind(population.form.id),
    db.prepare(countQuery.sql).bind(...countQuery.bindings),
    db.prepare(statisticsQuery.sql).bind(...statisticsQuery.bindings),
  ]);

  const fields = batchRows<FieldRow>(fieldsResult);
  // Keep labels for retired choices in historical aggregates even though
  // active form rendering no longer offers those values for new responses.
  const catalogs = await resolveFormFieldOptionCatalogs(db, fields, { includeInactive: true });

  return adminFormSubmissionStatsResponseSchema.parse({
    form: {
      id: population.form.id,
      key: population.form.key,
      title: population.form.title,
      purpose: population.form.purpose,
      placement: population.placement,
    },
    total: Number(batchFirst<{ total: number }>(countResult)?.total ?? 0),
    stats: buildFieldStatistics(fields, batchRows<AggregatedStatRow>(statisticsResult), catalogs),
  });
}
