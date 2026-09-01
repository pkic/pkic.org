import type { ComponentChildren, Ref } from "preact";
import { ProfileLinksInput, type ProfileLinksHandle } from "./ProfileLinksInput";
import { SPEAKER_ROLE_OPTIONS } from "../shared/speaker-roles";
import { Button } from "../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../ui/Panel";
import { Textarea, TextInput } from "../ui/TextControl";
// `pk-field`, `pk-field__label`, `pk-field__help`, `pk-field__message` and the
// `pk-check` trio are written here as class names rather than reached through a
// component, so this module has to pull their stylesheet into its own chunk.
// `TextInput`/`Textarea` already import it; naming it here keeps the file
// honest if those two are ever swapped for plain elements.
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
  children: (control: { id: string; "aria-describedby": string | undefined }) => ComponentChildren;
}

/**
 * One labelled control inside the speaker card.
 *
 * The id is supplied by the caller rather than generated, because these cards
 * are rendered into a plain HTML form whose validation writes each message
 * into the matching `[data-field-error]` slot after render. That makes the
 * slot a polite live region, and the control names it through
 * `aria-describedby` before any message exists — the relationship is markup
 * rather than runtime wiring, so it is right from the first paint.
 */
function SpeakerField({ id, label, optional = false, help, errorPath, children }: SpeakerFieldProps) {
  const helpId = help ? `${id}-help` : undefined;
  const errorId = errorPath ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div class="pk-field">
      <label class="pk-field__label" for={id}>
        {label}
        {optional && <span class="pk-small"> (optional)</span>}
      </label>
      {children({ id, "aria-describedby": describedBy })}
      {help && (
        <p class="pk-field__help" id={helpId}>
          {help}
        </p>
      )}
      {errorPath && <div class="pk-field__message" id={errorId} data-field-error={errorPath} aria-live="polite" />}
    </div>
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
            // which is what a reader hears on entering it. The previous
            // `aria-label` sat on a plain div beside a visible "Role" label
            // that pointed at no control at all.
            <fieldset class="pk-fieldset pk-stack pk-stack--tight">
              <legend class="pk-field__label">Role</legend>
              <div class="pk-cluster">
                {SPEAKER_ROLE_OPTIONS.map((role, index) => {
                  const id = `role-${idPrefix}-${role.value}`;
                  return (
                    <label class="pk-check" key={role.value} for={id}>
                      <input
                        class="pk-check__input"
                        type="radio"
                        name={roleField}
                        id={id}
                        value={role.value}
                        defaultChecked={role.value === defaultRole || (!defaultRole && index === 0)}
                      />
                      <span class="pk-check__label">{role.label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          <fieldset class="pk-fieldset pk-stack pk-stack--tight">
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
