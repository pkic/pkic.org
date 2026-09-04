import { useState } from "preact/hooks";
import {
  orgTiedMembershipCategorySchema,
  organizationCreateResponseSchema,
  organizationCreateSchema,
} from "../../../../../shared/schemas/organization-management";
import { ProfileLinksInput } from "../../../../components/ProfileLinksInput";
import { friendlyErrorMessage } from "../../../../components/ErrorAlert";
import { useContractForm } from "../../../../hooks/useContractForm";
import { postJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, TextInput } from "../../../../ui/TextControl";
import { toast } from "../../ui";

interface PersonDraft {
  name: string;
  email: string;
  jobTitle: string;
}

const ORG_TIED_MEMBERSHIP_CATEGORIES = orgTiedMembershipCategorySchema.options;

const MAX_PEOPLE = 10;

/**
 * The create-organization page: one organization aggregate, its web presence,
 * and — optionally — its first people. It stands in place of the directory
 * rather than unfolding inside it, so it carries its own way back out — the
 * same shape the roles and global-forms create views use.
 *
 * The form is three fieldsets in one column, each holding one concept: the
 * record itself, where it lives on the web, and who acts for it. People are
 * optional — an organization can exist before anyone represents it, and the
 * roster invites people properly later — so the activation reason only
 * appears, and is only required, once a person has been added.
 */
export function OrganizationCreateForm({
  onCreated,
  onCancel,
}: {
  onCreated: (organizationId: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");
  const [links, setLinks] = useState<string[]>([]);
  const [membershipCategory, setMembershipCategory] = useState(ORG_TIED_MEMBERSHIP_CATEGORIES[0]);
  const [memberSince, setMemberSince] = useState(() => new Date().toISOString().slice(0, 10));
  const [people, setPeople] = useState<PersonDraft[]>([]);
  const [activationReason, setActivationReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function updatePerson(index: number, patch: Partial<PersonDraft>) {
    setPeople((current) => current.map((person, position) => (position === index ? { ...person, ...patch } : person)));
  }

  /*
   * One basis for validation: the contract the route parses. The body used to
   * be assembled at submit time and sent unchecked, so a bad address on the
   * fourth person came back as one unattributed "Invalid request" for the
   * whole form.
   */
  const form = useContractForm(organizationCreateSchema, {
    name: name.trim(),
    ...(website.trim() ? { website: website.trim() } : {}),
    ...(description.trim() ? { description: description.trim() } : {}),
    ...(links.length > 0 ? { links } : {}),
    membershipCategory,
    memberSince,
    identities: people.map((person) => ({
      name: person.name.trim(),
      email: person.email.trim(),
      ...(person.jobTitle.trim() ? { jobTitle: person.jobTitle.trim() } : {}),
    })),
    workingGroupSlugs: [],
    ...(people.length > 0 ? { activationReason: activationReason.trim() } : {}),
  });

  async function submit(event: Event) {
    event.preventDefault();
    setError("");
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    try {
      const created = await postJson("/api/v1/organizations", checked.data, organizationCreateResponseSchema);
      toast("Organization created", "success");
      onCreated(created.organization.id);
    } catch (caught) {
      // A server refusal names its fields the way the contract does.
      const message = form.refuse(caught);
      setError(message);
      toast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="pk pk-stack">
      {/* The page's way back: creation has its own address, so leaving it is
          navigation rather than the disappearance of a layer. */}
      <div class="pk-cluster">
        <Button size="sm" onClick={onCancel} disabled={busy}>
          ← All organizations
        </Button>
      </div>
      <Panel aria-label="Add organization">
        <PanelHeader title="Add organization" headingLevel={2} />
        <PanelBody>
          <form noValidate class="pk-form" {...form.handlers} onSubmit={submit}>
            <fieldset class="pk-fieldset pk-field" disabled={busy}>
              {/* "Details", because the page has already said "organization"
                  twice by this line — the title and the field label carry
                  the word; the legend only groups. */}
              <legend class="pk-field__label">Details</legend>
              <div class="pk-stack pk-stack--snug">
                <Field label="Organization name" required {...form.of("name")}>
                  {(control) => (
                    <TextInput
                      {...control}
                      value={name}
                      onInput={(event) => setName((event.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
                <Field
                  label="Membership category"
                  help="Applied to every identity created for the organization."
                  {...form.of("membershipCategory")}
                >
                  {(control) => (
                    <Select
                      {...control}
                      value={membershipCategory}
                      onChange={(event) => setMembershipCategory((event.target as HTMLSelectElement).value)}
                    >
                      {ORG_TIED_MEMBERSHIP_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Member since" required {...form.of("memberSince")}>
                  {(control) => (
                    <TextInput
                      {...control}
                      type="date"
                      value={memberSince}
                      onInput={(event) => setMemberSince((event.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
                <Field label="Description" {...form.of("description")}>
                  {(control) => (
                    <TextInput
                      {...control}
                      value={description}
                      onInput={(event) => setDescription((event.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
              </div>
            </fieldset>

            {/* The website and the other public addresses are one concept, so
                they live in one group rather than competing across the form. */}
            <fieldset class="pk-fieldset pk-field" disabled={busy}>
              <legend class="pk-field__label">Web presence</legend>
              <div class="pk-stack pk-stack--snug">
                <Field label="Website" {...form.of("website")}>
                  {(control) => (
                    <TextInput
                      {...control}
                      type="url"
                      value={website}
                      onInput={(event) => setWebsite((event.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
                <ProfileLinksInput
                  fieldName="organization.links"
                  value={links}
                  inputAriaLabel="Additional organization URL"
                  helpText="Additional links for the organization's profile. Each is a plain URL and is labeled automatically by its site — for example, a linkedin.com address shows as LinkedIn."
                  onChange={setLinks}
                />
              </div>
            </fieldset>

            {/* A fieldset per person, so the repeated "Name" and "Email"
                labels are announced inside the card they belong to rather
                than as several identically named controls in one form. */}
            <fieldset class="pk-fieldset pk-field" disabled={busy}>
              <legend class="pk-field__label">People</legend>
              <div class="pk-stack">
                <p class="pk-small">
                  Optional. Anyone added here starts acting for the organization immediately, without receiving an
                  invitation. Profile details such as links are added later on the person.
                </p>
                {people.map((person, index) => (
                  // The frame is load-bearing: it is what keeps a person's
                  // "Name" from reading as another field of the organization.
                  <fieldset class="pk-fieldset pk-fieldset--boxed pk-field" key={index}>
                    <legend class="pk-field__label">Person {index + 1}</legend>
                    <div class="pk-stack pk-stack--snug">
                      <Field label="Name" required>
                        {(control) => (
                          <TextInput
                            {...control}
                            value={person.name}
                            onInput={(event) => updatePerson(index, { name: (event.target as HTMLInputElement).value })}
                          />
                        )}
                      </Field>
                      <Field label="Email" required>
                        {(control) => (
                          <TextInput
                            {...control}
                            type="email"
                            value={person.email}
                            onInput={(event) =>
                              updatePerson(index, { email: (event.target as HTMLInputElement).value })
                            }
                          />
                        )}
                      </Field>
                      <Field label="Job title">
                        {(control) => (
                          <TextInput
                            {...control}
                            value={person.jobTitle}
                            onInput={(event) =>
                              updatePerson(index, { jobTitle: (event.target as HTMLInputElement).value })
                            }
                          />
                        )}
                      </Field>
                      <div class="pk-cluster pk-cluster--end">
                        <Button
                          variant="danger-quiet"
                          size="sm"
                          onClick={() => setPeople((current) => current.filter((_, position) => position !== index))}
                        >
                          Remove person {index + 1}
                        </Button>
                      </div>
                    </div>
                  </fieldset>
                ))}
                <div class="pk-cluster">
                  <Button
                    size="sm"
                    disabled={people.length >= MAX_PEOPLE}
                    onClick={() => setPeople((current) => [...current, { name: "", email: "", jobTitle: "" }])}
                  >
                    Add person
                  </Button>
                </div>
                {people.length > 0 && (
                  <Field
                    label="Reason for activating without an invitation"
                    required
                    help="These people skip the usual invitation and acceptance. The reason is recorded in the audit log."
                  >
                    {(control) => (
                      <TextInput
                        {...control}
                        value={activationReason}
                        onInput={(event) => setActivationReason(event.currentTarget.value)}
                      />
                    )}
                  </Field>
                )}
              </div>
            </fieldset>

            {error && <Alert tone="danger">{friendlyErrorMessage(error)}</Alert>}

            <div class="pk-cluster">
              <Button type="submit" variant="primary" loading={busy}>
                {busy ? "Creating…" : "Create organization"}
              </Button>
              <Button onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        </PanelBody>
      </Panel>
    </div>
  );
}
