import { useState } from "preact/hooks";
import {
  orgTiedMembershipCategorySchema,
  organizationCreateResponseSchema,
} from "../../../../../shared/schemas/organization-management";
import { ProfileLinksInput } from "../../../../components/ProfileLinksInput";
import { FormActions } from "../../../../components/FormActions";
import { postJson } from "../../../../shared/api-client";
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
    <form class="card border-0 shadow-sm mb-3" onSubmit={submit}>
      <div class="card-header bg-white fw-semibold">Add organization</div>
      <div class="card-body">
        <div class="row g-2 mb-2">
          <div class="col-md-5">
            <label class="form-label small fw-semibold" for="organization-create-name">
              Organization name
            </label>
            <input
              id="organization-create-name"
              class="form-control form-control-sm"
              value={name}
              onInput={(event) => setName((event.target as HTMLInputElement).value)}
              required
              disabled={busy}
            />
          </div>
          <div class="col-md-3">
            <label class="form-label small fw-semibold" for="organization-create-category">
              Membership category
            </label>
            <select
              id="organization-create-category"
              class="form-select form-select-sm"
              value={membershipCategory}
              onChange={(event) => setMembershipCategory((event.target as HTMLSelectElement).value)}
              disabled={busy}
            >
              {ORG_TIED_MEMBERSHIP_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
          <div class="col-md-4">
            <label class="form-label small fw-semibold" for="organization-create-member-since">
              Member since
            </label>
            <input
              id="organization-create-member-since"
              class="form-control form-control-sm"
              type="date"
              value={memberSince}
              onInput={(event) => setMemberSince((event.target as HTMLInputElement).value)}
              required
              disabled={busy}
            />
          </div>
          <div class="col-md-6">
            <label class="form-label small" for="organization-create-website">
              Website
            </label>
            <input
              id="organization-create-website"
              class="form-control form-control-sm"
              type="url"
              value={website}
              onInput={(event) => setWebsite((event.target as HTMLInputElement).value)}
              disabled={busy}
            />
          </div>
          <div class="col-md-6">
            <label class="form-label small" for="organization-create-description">
              Description
            </label>
            <input
              id="organization-create-description"
              class="form-control form-control-sm"
              value={description}
              onInput={(event) => setDescription((event.target as HTMLInputElement).value)}
              disabled={busy}
            />
          </div>
        </div>

        <fieldset class="mb-3">
          <legend class="form-label small fw-semibold">Initial identities</legend>
          <div class="form-text mb-2">
            Creating an organization activates these identities immediately and requires identities:activate.
          </div>
          {identities.map((identity, index) => (
            <div class="row g-2 mb-2 align-items-end" key={index}>
              <div class="col-md-3">
                <label class="form-label small" for={`organization-create-identity-name-${index}`}>
                  Name
                </label>
                <input
                  id={`organization-create-identity-name-${index}`}
                  class="form-control form-control-sm"
                  value={identity.name}
                  onInput={(event) => updateIdentity(index, { name: (event.target as HTMLInputElement).value })}
                  required
                  disabled={busy}
                />
              </div>
              <div class="col-md-3">
                <label class="form-label small" for={`organization-create-identity-email-${index}`}>
                  Email
                </label>
                <input
                  id={`organization-create-identity-email-${index}`}
                  class="form-control form-control-sm"
                  type="email"
                  value={identity.email}
                  onInput={(event) => updateIdentity(index, { email: (event.target as HTMLInputElement).value })}
                  required
                  disabled={busy}
                />
              </div>
              <div class="col-md-2">
                <label class="form-label small" for={`organization-create-identity-title-${index}`}>
                  Job title
                </label>
                <input
                  id={`organization-create-identity-title-${index}`}
                  class="form-control form-control-sm"
                  value={identity.jobTitle}
                  onInput={(event) => updateIdentity(index, { jobTitle: (event.target as HTMLInputElement).value })}
                  disabled={busy}
                />
              </div>
              <div class="col-md-3">
                <label class="form-label small">Profile links</label>
                <ProfileLinksInput
                  fieldName={`identities.${index}.links`}
                  value={identity.links}
                  onChange={(links) => updateIdentity(index, { links })}
                />
              </div>
              <div class="col-md-1">
                {identities.length > 1 && (
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-danger w-100"
                    disabled={busy}
                    onClick={() => setIdentities((current) => current.filter((_, position) => position !== index))}
                    aria-label={`Remove identity ${index + 1}`}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          ))}
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary"
            disabled={busy || identities.length >= 10}
            onClick={() => setIdentities((current) => [...current, emptyIdentity()])}
          >
            Add identity
          </button>
        </fieldset>

        <div class="mb-3">
          <label class="form-label small fw-semibold" for="organization-create-activation-reason">
            Immediate activation reason
          </label>
          <input
            id="organization-create-activation-reason"
            class="form-control form-control-sm"
            value={activationReason}
            onInput={(event) => setActivationReason(event.currentTarget.value)}
            required
            disabled={busy}
          />
        </div>

        <FormActions
          submitLabel="Create organization"
          busyLabel="Creating…"
          busy={busy}
          onCancel={onCancel}
          status={error}
        />
      </div>
    </form>
  );
}
