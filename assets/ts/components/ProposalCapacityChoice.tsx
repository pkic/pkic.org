import type { MemberJoinApplicantKind } from "../../shared/schemas/member-join";
import { Alert } from "../ui/Alert";
import { Radio } from "../ui/Checkbox";
import { Field } from "../ui/Field";

/**
 * In what capacity a person proposes or presents a session. This is not the
 * membership question (whether someone is employed by an organization): an
 * employee may still speak as an individual, but a talk given on behalf of an
 * organization must say so, because that organization authorizes it.
 */
export function ProposalCapacityChoice({
  question,
  value,
  onChange,
}: {
  question: string;
  value?: MemberJoinApplicantKind;
  onChange: (kind: MemberJoinApplicantKind) => void;
}) {
  const choose = (event: { currentTarget: HTMLInputElement }) => {
    const kind = event.currentTarget.value;
    if (kind === "organization" || kind === "individual") onChange(kind);
  };
  return (
    <>
      <Field group label={question} errorSlot="applicantKind">
        {(control) => (
          <div class="pk-stack pk-stack--snug">
            <Radio
              name="applicantKind"
              value="organization"
              checked={value === undefined ? undefined : value === "organization"}
              onChange={choose}
              required
              aria-describedby={control["aria-describedby"]}
              label="On behalf of an organization (my employer or my own company)"
              hint="The proposal is associated with that organization. You confirm it with your work email address there."
            />
            <Radio
              name="applicantKind"
              value="individual"
              checked={value === undefined ? undefined : value === "individual"}
              onChange={choose}
              required
              aria-describedby={control["aria-describedby"]}
              label="As an individual"
            />
          </div>
        )}
      </Field>
      {value === "individual" && (
        <Alert tone="info">
          Individual speakers usually arrange and pay for their own travel and attendance. A talk given on behalf of an
          organization must be submitted on its behalf, because the organization authorizes the talk and may own the
          material presented.
        </Alert>
      )}
    </>
  );
}
