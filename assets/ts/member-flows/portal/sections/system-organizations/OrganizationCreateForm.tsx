import { useState } from "preact/hooks";
import {
  orgTiedMembershipCategorySchema,
  organizationCreateResponseSchema,
  organizationCreateSchema,
} from "../../../../../shared/schemas/organization-management";
import { ProfileLinksInput } from "../../../../components/ProfileLinksInput";
import { friendlyErrorMessage } from "../../../../components/ErrorAlert";
import { useContractForm } from "../../../../hooks/useContractForm";
import { useMembershipCategoryCatalog } from "../../../../hooks/useMembershipCategoryCatalog";
import { postJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { Checkbox } from "../../../../ui/Checkbox";
import { Field } from "../../../../ui/Field";
import { FormSection } from "../../../../ui/FormSection";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, Textarea, TextInput } from "../../../../ui/TextControl";
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
  /*
   * Membership is a separate act, so it is a choice on this form rather than
   * a field nobody may leave blank. An organization is a record the
   * consortium keeps — an attendee's employer, a sponsor, a company in
   * conversation — and it becomes a member by signing up or by being granted
   * one, not by being written down (#53).
   */
  const [isMember, setIsMember] = useState(false);
  const [membershipCategory, setMembershipCategory] = useState(ORG_TIED_MEMBERSHIP_CATEGORIES[0]);
  const [memberSince, setMemberSince] = useState(() => new Date().toISOString().slice(0, 10));
  const [people, setPeople] = useState<PersonDraft[]>([]);
  const categories = useMembershipCategoryCatalog();

  /** "Full member (A)", not a bare "A" — the code means nothing on its own. */
  function categoryLabel(code: string): string {
    const entry = categories.find((candidate: { code: string }) => candidate.code === code);
    return entry ? `${entry.label} (${code})` : code;
  }
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
    ...(isMember ? { membershipCategory, memberSince } : {}),
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
    <div class="pk pk-stack pk-container pk-container--narrow pk-container--start">
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
            <FormSection title="Details">
              <fieldset class="pk-fieldset" disabled={busy}>
                <Field label="Organization name" required {...form.of("name")}>
                  {(control) => (
                    <TextInput
                      {...control}
                      value={name}
                      onInput={(event) => setName((event.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
                {/* Prose, so a box the shape of prose: a one-line input asked
                    for a sentence and showed the first forty characters of it. */}
                <Field label="Description" {...form.of("description")}>
                  {(control) => (
                    <Textarea
                      {...control}
                      rows={3}
                      value={description}
                      onInput={(event) => setDescription((event.target as HTMLTextAreaElement).value)}
                    />
                  )}
                </Field>
              </fieldset>
            </FormSection>

            {/* Membership is its own act. The checkbox is the whole question —
                is this organization a member? — and the terms of the membership
                only exist once it is answered yes. */}
            <FormSection
              title="Membership"
              description="An organization does not have to be a member. Members sign up through an application, or are given a membership here."
            >
              <fieldset class="pk-fieldset" disabled={busy}>
                <Checkbox
                  name="isMember"
                  checked={isMember}
                  onChange={(event) => setIsMember((event.target as HTMLInputElement).checked)}
                  label="This organization is a consortium member"
                />
                {isMember && (
                  <>
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
                          {/* The code alone says nothing to anybody who has not
                          memorized the bylaws' table. The catalog names each
                          one, the way the individual grant form already does
                          (#53); the code stays, because that is what the
                          bylaws and the rest of the portal address. */}
                          {ORG_TIED_MEMBERSHIP_CATEGORIES.map((category) => (
                            <option key={category} value={category}>
                              {categoryLabel(category)}
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
                  </>
                )}
              </fieldset>
            </FormSection>

            {/* The website and the other public addresses are one concept, so
                they live in one group rather than competing across the form. */}
            <FormSection title="Web presence">
              <fieldset class="pk-fieldset" disabled={busy}>
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
                  label="Other links"
                  value={links}
                  inputAriaLabel="Additional organization URL"
                  helpText="One URL per line. Each is labeled by its site — a linkedin.com address shows as LinkedIn."
                  onChange={setLinks}
                />
              </fieldset>
            </FormSection>

            {/* A fieldset per person, so the repeated "Name" and "Email"
                labels are announced inside the card they belong to rather
                than as several identically named controls in one form. */}
            {/* Representatives act for a member, so they are offered only once
                there is a membership for them to act for — the contract
                refuses them otherwise, and a form should not offer what the
                server will refuse. */}
            {isMember && (
              <FormSection
                title="People"
                description="Optional. Anyone added here starts acting for the organization immediately, without an invitation."
              >
                <fieldset class="pk-fieldset" disabled={busy}>
                  <div class="pk-stack">
                    {people.map((person, index) => (
                      // The frame is load-bearing: it is what keeps a person's
                      // "Name" from reading as another field of the organization.
                      <fieldset class="pk-fieldset pk-fieldset--boxed pk-field" key={index}>
                        {/* A boxed card, so its legend names the card rather than
                        opening a section — the frame already does the work a
                        section heading would. */}
                        <legend class="pk-field__label">Person {index + 1}</legend>
                        <div class="pk-stack pk-stack--snug">
                          <Field label="Name" required>
                            {(control) => (
                              <TextInput
                                {...control}
                                value={person.name}
                                onInput={(event) =>
                                  updatePerson(index, { name: (event.target as HTMLInputElement).value })
                                }
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
                              onClick={() =>
                                setPeople((current) => current.filter((_, position) => position !== index))
                              }
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
              </FormSection>
            )}

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
