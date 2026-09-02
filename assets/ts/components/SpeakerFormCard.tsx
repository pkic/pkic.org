import type { ComponentChildren, Ref } from "preact";
import { ProfileLinksInput, type ProfileLinksHandle } from "./ProfileLinksInput";
import { SPEAKER_ROLE_OPTIONS } from "../shared/speaker-roles";
import { Button } from "../ui/Button";
import { Radio } from "../ui/Checkbox";
import { Panel, PanelBody, PanelHeader } from "../ui/Panel";
import { Field, type FieldControlProps } from "../ui/Field";
import { Textarea, TextInput } from "../ui/TextControl";
// `pk-field`, `pk-field__label`, `pk-field__help` and `pk-field__message` are
// written here as class names rather than reached through a component, so
// this module has to pull their stylesheet into its own chunk. `TextInput`,
// `Textarea` and `Radio` already import it; naming it here keeps the file
// honest if those are ever swapped for plain elements.
import "../ui/Field.css";

export interface SpeakerFieldNames {
  firstName: string;
  lastName: string;
  email: string;
  organizationName: string;
  jobTitle: string;
  bio: string;
  role?: string;
}

interface SpeakerFormCardProps {
  title: string;
  idPrefix: string;
  fields: SpeakerFieldNames;
  linksFieldName: string;
  linksRef: Ref<ProfileLinksHandle>;
  emailHelp: string;
  bioHelp: string;
  autocomplete?: boolean;
  defaultRole?: string;
  errorPaths?: Partial<Record<"firstName" | "lastName" | "email" | "bio", string>>;
  onRemove?: () => void;
}

interface SpeakerFieldProps {
  id: string;
  label: string;
  /** Annotates the label rather than leaving "optional" to be inferred. */
  optional?: boolean;
  help?: string;
  /** The validation path `applyFieldErrors` writes this control's message to. */
  errorPath?: string;
  children: (control: FieldControlProps) => ComponentChildren;
}

/**
 * One labelled control inside the speaker card: the design system's `Field`,
 * with the message slot the card's DOM-driven validator writes into after
 * render (`applyFieldErrors` addresses it by `data-field-error`), and the
 * caller's id so the surrounding form's markup can keep addressing it.
 */
function SpeakerField({ id, label, optional = false, help, errorPath, children }: SpeakerFieldProps) {
  return (
    <Field id={id} label={optional ? `${label} (optional)` : label} help={help} errorSlot={errorPath}>
      {children}
    </Field>
  );
}

export function SpeakerFormCard({
  title,
  idPrefix,
  fields,
  linksFieldName,
  linksRef,
  emailHelp,
  bioHelp,
  autocomplete,
  defaultRole = "speaker",
  errorPaths,
  onRemove,
}: SpeakerFormCardProps) {
  const roleField = fields.role;

  return (
    <div class="pk">
      {/* The card names itself as a region, so a reader moving between several
          speakers lands on "Speaker 2" rather than on an anonymous group. */}
      <Panel aria-label={title}>
        <PanelHeader title={title} headingLevel={4}>
          {onRemove && (
            <Button variant="danger-quiet" size="sm" onClick={onRemove}>
              Remove
            </Button>
          )}
        </PanelHeader>
        <PanelBody class="pk-stack">
          <div class="pk-grid">
            <SpeakerField id={`${idPrefix}-first`} label="First name" errorPath={errorPaths?.firstName}>
              {(control) => (
                <TextInput
                  {...control}
                  name={fields.firstName}
                  required
                  {...(autocomplete ? { autocomplete: "given-name" } : {})}
                />
              )}
            </SpeakerField>
            <SpeakerField id={`${idPrefix}-last`} label="Last name" errorPath={errorPaths?.lastName}>
              {(control) => (
                <TextInput
                  {...control}
                  name={fields.lastName}
                  required
                  {...(autocomplete ? { autocomplete: "family-name" } : {})}
                />
              )}
            </SpeakerField>
          </div>

          <SpeakerField id={`${idPrefix}-email`} label="Email" help={emailHelp} errorPath={errorPaths?.email}>
            {(control) => (
              <TextInput
                {...control}
                name={fields.email}
                type="email"
                required
                {...(autocomplete ? { autocomplete: "email" } : {})}
              />
            )}
          </SpeakerField>

          <div class="pk-grid">
            <SpeakerField id={`${idPrefix}-org`} label="Organization" optional>
              {(control) => (
                <TextInput
                  {...control}
                  name={fields.organizationName}
                  {...(autocomplete ? { autocomplete: "organization" } : {})}
                />
              )}
            </SpeakerField>
            <SpeakerField id={`${idPrefix}-title`} label="Job title" optional>
              {(control) => (
                <TextInput
                  {...control}
                  name={fields.jobTitle}
                  {...(autocomplete ? { autocomplete: "organization-title" } : {})}
                />
              )}
            </SpeakerField>
          </div>

          <SpeakerField id={`${idPrefix}-bio`} label="Bio" help={bioHelp} errorPath={errorPaths?.bio}>
            {(control) => <Textarea {...control} name={fields.bio} rows={4} required minLength={40} maxLength={5000} />}
          </SpeakerField>

          {roleField && (
            // A fieldset with a legend names the radio group in the markup,
            // which is what a reader hears on entering it.
            <fieldset class="pk-fieldset pk-field">
              <legend class="pk-field__label">Role</legend>
              <div class="pk-cluster">
                {SPEAKER_ROLE_OPTIONS.map((role, index) => (
                  <Radio
                    key={role.value}
                    name={roleField}
                    value={role.value}
                    defaultChecked={role.value === defaultRole || (!defaultRole && index === 0)}
                    label={role.label}
                  />
                ))}
              </div>
            </fieldset>
          )}

          <fieldset class="pk-fieldset pk-field">
            <legend class="pk-field__label">
              Profile links
              <span class="pk-small"> (optional)</span>
            </legend>
            <ProfileLinksInput ref={linksRef} fieldName={linksFieldName} />
          </fieldset>
        </PanelBody>
      </Panel>
    </div>
  );
}
