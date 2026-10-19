import { useEffect, useState } from "preact/hooks";
import {
  ORGANIZATION_JOB_TITLE_COPY as jobTitleCopy,
  REGISTRATION_ORGANIZATION_COPY as copy,
} from "../../shared/email-first-copy";
import {
  registrationConfirmOrganizationSchema,
  type RegistrationConfirmOrganization as Organization,
} from "../../shared/schemas/registration";
import { useContractForm } from "../hooks/useContractForm";
import { Field } from "../ui/Field";
import { TextInput } from "../ui/TextControl";

/** What the confirmation's submit reads: the organization to send, or a refusal the fields now show. */
export interface ConfirmOrganizationController {
  read?: () => { organization: Organization } | { refused: true };
}

/**
 * The organization a verified work address names when its domain resolves
 * to none, asked once — after the person has proved the mailbox by opening
 * the link: in the registration form, or on the confirmation page for a
 * registration that waited for email confirmation. The server links it through the canonical
 * affiliation rule or queues it for review; nothing here decides that.
 */
export function RegistrationConfirmOrganization({ controller }: { controller: ConfirmOrganizationController }) {
  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const body = { name, jobTitle };
  const form = useContractForm(registrationConfirmOrganizationSchema, body);
  controller.read = () => {
    const checked = form.submit();
    return checked.data ? { organization: checked.data } : { refused: true };
  };
  // Once the question is gone (another address was chosen), nothing is asked or sent.
  useEffect(
    () => () => {
      delete controller.read;
    },
    [controller],
  );
  return (
    <div class="pk-stack" {...form.handlers}>
      <p>{copy.question}</p>
      <Field label={copy.nameLabel} help={copy.help} required {...form.of("name")}>
        {(control) => (
          <TextInput
            {...control}
            name="name"
            value={name}
            autoComplete="organization"
            onInput={(event) => setName(event.currentTarget.value)}
          />
        )}
      </Field>
      <Field label={jobTitleCopy.label} help={jobTitleCopy.help} required {...form.of("jobTitle")}>
        {(control) => (
          <TextInput
            {...control}
            name="jobTitle"
            value={jobTitle}
            autoComplete="organization-title"
            onInput={(event) => setJobTitle(event.currentTarget.value)}
          />
        )}
      </Field>
    </div>
  );
}
