import type { MembershipApplicationDetail } from "../../../../../shared/schemas/membership-application-management";
import { useState } from "preact/hooks";
import type { z } from "zod";
import { applicationEditableAnswersSchema } from "../../../../../shared/schemas/membership-application-management";
import type { FieldPresentation } from "../../../../hooks/useContractForm";
import { activeAdminWorkingGroupCatalog } from "../../../../shared/management-catalogs";
import { ServerSearchSelect } from "../../../../components/ServerSearchSelect";
import { Button } from "../../../../ui/Button";
import { Checkbox } from "../../../../ui/Checkbox";
import { Field } from "../../../../ui/Field";
import { Select } from "../../../../ui/TextControl";

type Answers = z.infer<typeof applicationEditableAnswersSchema>;
const choices = [
  ["wants_to_present", "Wants to present"],
  ["interested_in_sponsoring", "Interested in sponsoring"],
  ["agrees_bylaws", "Agrees to the Bylaws"],
  ["agrees_code_of_conduct", "Agrees to the Code of Conduct"],
  ["agrees_ipr_policy", "Agrees to the IPR Policy"],
  ["warranted_authority", "Warranted authority"],
] as const;
const groups = activeAdminWorkingGroupCatalog();

export function ApplicationAnswerFields({
  answers,
  fields,
  requestedWorkingGroups,
  of,
  onChange,
}: {
  answers: Answers;
  fields?: MembershipApplicationDetail["answerFields"];
  requestedWorkingGroups?: MembershipApplicationDetail["requestedWorkingGroups"];
  of: (name: string) => FieldPresentation;
  onChange: (answers: Answers) => void;
}) {
  const [names, setNames] = useState<Record<string, string>>(
    Object.fromEntries([
      ...(fields?.find((field) => field.key === "working_groups")?.options ?? []).map((option) => [
        option.value,
        option.label,
      ]),
      ...(requestedWorkingGroups ?? []).map((group) => [group.slug, group.name]),
    ]),
  );
  return (
    <div class="pk-stack">
      <Field label="Contribution type" {...of("answers.contribution_type")}>
        {(control) => (
          <Select
            {...control}
            name="answers.contribution_type"
            value={answers.contribution_type ?? ""}
            onChange={(event) =>
              onChange({
                ...answers,
                contribution_type: applicationEditableAnswersSchema.shape.contribution_type.parse(
                  event.currentTarget.value || null,
                ),
              })
            }
          >
            <option value="">Not provided</option>
            {(fields?.find((field) => field.key === "contribution_type")?.options ?? []).map((option) => (
              <option key={option.value} value={option.value} disabled={!option.active}>
                {option.label}
              </option>
            ))}
            {!fields?.length && answers.contribution_type && (
              <option value={answers.contribution_type}>{answers.contribution_type}</option>
            )}
          </Select>
        )}
      </Field>
      <p class="pk-small">
        Record the applicant's answers. Legal acknowledgments require the applicant's agreement; staff cannot consent on
        their behalf.
      </p>
      {choices.map(([key, label]) => (
        <Field key={key} label={label} {...of(`answers.${key}`)}>
          {(control) => (
            <Checkbox
              {...control}
              name={`answers.${key}`}
              label="Yes"
              checked={answers[key] === true}
              onChange={(event) => onChange({ ...answers, [key]: event.currentTarget.checked })}
            />
          )}
        </Field>
      ))}
      <Field label="Working groups requested" {...of("answers.working_groups")}>
        {(control) => (
          <ServerSearchSelect
            {...control}
            catalog={groups}
            searchLabel="Working group"
            value={null}
            excludeValues={answers.working_groups ?? []}
            onChange={(group) => {
              if (!group) return;
              setNames((current) => ({ ...current, [group.id]: group.name }));
              onChange({ ...answers, working_groups: [...(answers.working_groups ?? []), group.id] });
            }}
          />
        )}
      </Field>
      {(answers.working_groups ?? []).map((slug) => (
        <div class="pk-cluster" key={slug}>
          <span>{names[slug] ?? slug}</span>
          <Button
            type="button"
            size="sm"
            aria-label={`Remove ${names[slug] ?? slug}`}
            onClick={() =>
              onChange({ ...answers, working_groups: answers.working_groups?.filter((value) => value !== slug) })
            }
          >
            Remove
          </Button>
        </div>
      ))}
    </div>
  );
}
