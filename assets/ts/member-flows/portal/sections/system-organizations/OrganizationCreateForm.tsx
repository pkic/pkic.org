import { useState } from "preact/hooks";
import {
  orgTiedMembershipCategorySchema,
  organizationCreateResponseSchema,
} from "../../../../../shared/schemas/organization-management";
import { ProfileLinksInput } from "../../../../components/ProfileLinksInput";
import { friendlyErrorMessage } from "../../../../components/ErrorAlert";
import { postJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, TextInput } from "../../../../ui/TextControl";
import { toast } from "../../ui";

interface IdentityDraft {
  name: string;
  email: string;
  jobTitle: string;
  links: string[];
}

function emptyIdentity(): IdentityDraft {
  return { name: "", email: "", jobTitle: "", links: [] };
}

const ORG_TIED_MEMBERSHIP_CATEGORIES = orgTiedMembershipCategorySchema.options;

/** Creates one organization aggregate with its initial approved identities. */
export function OrganizationCreateForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");
  const [membershipCategory, setMembershipCategory] = useState(ORG_TIED_MEMBERSHIP_CATEGORIES[0]);
  const [memberSince, setMemberSince] = useState(() => new Date().toISOString().slice(0, 10));
  const [identities, setIdentities] = useState<IdentityDraft[]>([emptyIdentity()]);
  const [activationReason, setActivationReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function updateIdentity(index: number, patch: Partial<IdentityDraft>) {
    setIdentities((current) =>
      current.map((identity, position) => (position === index ? { ...identity, ...patch } : identity)),
    );
  }

  async function submit(event: Event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await postJson(
        "/api/v1/organizations",
        {
          name: name.trim(),
          ...(website.trim() ? { website: website.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          membershipCategory,
          memberSince,
          identities: identities.map((identity) => ({
            name: identity.name.trim(),
            email: identity.email.trim(),
            ...(identity.jobTitle.trim() ? { jobTitle: identity.jobTitle.trim() } : {}),
            ...(identity.links.length > 0 ? { links: identity.links } : {}),
          })),
          workingGroupSlugs: [],
          activationReason: activationReason.trim(),
        },
        organizationCreateResponseSchema,
      );
      toast("Organization created", "success");
      onCreated();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="pk">
      <Panel aria-label="Add organization">
        <PanelHeader title="Add organization" headingLevel={2} />
        <PanelBody>
          <form class="pk-stack" onSubmit={submit}>
            <div class="pk-grid pk-grid--tight">
              <Field label="Organization name" required>
                {(control) => (
                  <TextInput
                    {...control}
                    value={name}
                    disabled={busy}
                    onInput={(event) => setName((event.target as HTMLInputElement).value)}
                  />
                )}
              </Field>
              <Field label="Membership category" help="Applied to every identity created with the organization.">
                {(control) => (
                  <Select
                    {...control}
                    value={membershipCategory}
                    disabled={busy}
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
              <Field label="Member since" required>
                {(control) => (
                  <TextInput
                    {...control}
                    type="date"
                    value={memberSince}
                    disabled={busy}
                    onInput={(event) => setMemberSince((event.target as HTMLInputElement).value)}
                  />
                )}
              </Field>
              <Field label="Website">
                {(control) => (
                  <TextInput
                    {...control}
                    type="url"
                    value={website}
                    disabled={busy}
                    onInput={(event) => setWebsite((event.target as HTMLInputElement).value)}
                  />
                )}
              </Field>
              <Field label="Description">
                {(control) => (
                  <TextInput
                    {...control}
                    value={description}
                    disabled={busy}
                    onInput={(event) => setDescription((event.target as HTMLInputElement).value)}
                  />
                )}
              </Field>
            </div>

            {/* A fieldset per identity, so the repeated "Name" and "Email"
                labels are announced inside the group they belong to rather
                than as several identically named controls in one form. */}
            <fieldset class="pk-fieldset pk-field">
              <legend class="pk-field__label">Initial identities</legend>
              <div class="pk-stack">
                <p class="pk-small">
                  Creating an organization activates these identities immediately and requires identities:activate.
                </p>
                {identities.map((identity, index) => (
                  <fieldset class="pk-fieldset pk-field" key={index}>
                    <legend class="pk-field__label">Identity {index + 1}</legend>
                    <div class="pk-stack pk-stack--snug">
                      <div class="pk-grid pk-grid--tight">
                        <Field label="Name" required>
                          {(control) => (
                            <TextInput
                              {...control}
                              value={identity.name}
                              disabled={busy}
                              onInput={(event) =>
                                updateIdentity(index, { name: (event.target as HTMLInputElement).value })
                              }
                            />
                          )}
                        </Field>
                        <Field label="Email" required>
                          {(control) => (
                            <TextInput
                              {...control}
                              type="email"
                              value={identity.email}
                              disabled={busy}
                              onInput={(event) =>
                                updateIdentity(index, { email: (event.target as HTMLInputElement).value })
                              }
                            />
                          )}
                        </Field>
                        <Field label="Job title">
                          {(control) => (
                            <TextInput
                              {...control}
                              value={identity.jobTitle}
                              disabled={busy}
                              onInput={(event) =>
                                updateIdentity(index, { jobTitle: (event.target as HTMLInputElement).value })
                              }
                            />
                          )}
                        </Field>
                      </div>
                      {/* The link editor is several controls, not one, so the
                          group is named by a legend rather than by a label with
                          nothing to point at. */}
                      <fieldset class="pk-fieldset pk-field">
                        <legend class="pk-field__label">Profile links</legend>
                        <ProfileLinksInput
                          fieldName={`identities.${String(index)}.links`}
                          value={identity.links}
                          inputAriaLabel={`Profile URL for identity ${String(index + 1)}`}
                          onChange={(links) => updateIdentity(index, { links })}
                        />
                      </fieldset>
                      {identities.length > 1 && (
                        <div class="pk-cluster pk-cluster--end">
                          <Button
                            variant="danger-quiet"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              setIdentities((current) => current.filter((_, position) => position !== index))
                            }
                          >
                            Remove identity {index + 1}
                          </Button>
                        </div>
                      )}
                    </div>
                  </fieldset>
                ))}
                <div class="pk-cluster">
                  <Button
                    size="sm"
                    disabled={busy || identities.length >= 10}
                    onClick={() => setIdentities((current) => [...current, emptyIdentity()])}
                  >
                    Add identity
                  </Button>
                </div>
              </div>
            </fieldset>

            <Field label="Immediate activation reason" required>
              {(control) => (
                <TextInput
                  {...control}
                  value={activationReason}
                  disabled={busy}
                  onInput={(event) => setActivationReason(event.currentTarget.value)}
                />
              )}
            </Field>

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
