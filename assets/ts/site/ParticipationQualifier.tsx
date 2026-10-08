import type { JSX } from "preact";
import { Field } from "../ui/Field";
import { Radio } from "../ui/Checkbox";

/** One participation question shared by joining and event entry, independent of membership categories. */
export function ParticipationQualifier({
  name = "applicantKind",
  errorSlot = name,
  value,
  onChange,
}: {
  name?: string;
  errorSlot?: string;
  value?: string;
  onChange?: JSX.GenericEventHandler<HTMLInputElement>;
}) {
  return (
    <Field
      group
      label="Are you employed by, or do you own, an organization?"
      errorSlot={errorSlot}
      help="If an organization has separately authorized you to act on its behalf, choose Yes even if you are not its employee or owner."
    >
      {(control) => (
        <div class="pk-stack pk-stack--snug">
          <Radio
            name={name}
            value="organization"
            checked={value === undefined ? undefined : value === "organization"}
            onChange={onChange}
            required
            aria-describedby={control["aria-describedby"]}
            label="Yes — I am employed by or own an organization"
          />
          <Radio
            name={name}
            value="individual"
            checked={value === undefined ? undefined : value === "individual"}
            onChange={onChange}
            required
            aria-describedby={control["aria-describedby"]}
            label="No — I am not employed by and do not own an organization"
          />
        </div>
      )}
    </Field>
  );
}
