import { useState } from "preact/hooks";
import {
  orgTiedMembershipCategorySchema,
  organizationDetailResponseSchema,
  type OrganizationDetail,
} from "../../../../../shared/schemas/organization-management";
import { friendlyErrorMessage } from "../../../../components/ErrorAlert";
import { ProfileLinksInput } from "../../../../components/ProfileLinksInput";
import { patchJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { DescriptionList, type DescriptionListItem } from "../../../../ui/DescriptionList";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, Textarea, TextInput } from "../../../../ui/TextControl";
import { fmt, fmtDate, toast } from "../../ui";
import "../../../../ui/Content.css";

const ORG_TIED_MEMBERSHIP_CATEGORIES = orgTiedMembershipCategorySchema.options;

const PROFILE_FIELDS = [
  ["Name", "name"],
  ["Slogan", "slogan"],
  ["Website", "website"],
  ["Blog URL", "blogUrl"],
  ["Blog feed URL", "blogFeedUrl"],
  ["Press URL", "pressUrl"],
  ["Press feed URL", "pressFeedUrl"],
  ["Careers URL", "careersUrl"],
] as const;

type ProfileField = (typeof PROFILE_FIELDS)[number][1];

function OrganizationProfileForm({
  organization,
  onSaved,
  onCancel,
}: {
  organization: OrganizationDetail;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Record<ProfileField, string>>(
    () =>
      Object.fromEntries(PROFILE_FIELDS.map(([, field]) => [field, organization[field] ?? ""])) as Record<
        ProfileField,
        string
      >,
  );
  const [description, setDescription] = useState(organization.description ?? "");
  const [contentMarkdown, setContentMarkdown] = useState(organization.contentMarkdown ?? "");
  const [links, setLinks] = useState(organization.links);
  const [membershipCategory, setMembershipCategory] = useState(
    organization.membershipCategory ?? ORG_TIED_MEMBERSHIP_CATEGORIES[0],
  );
  const [memberSince, setMemberSince] = useState(organization.memberSince.slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: Event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await patchJson(
        `/api/v1/organizations/${encodeURIComponent(organization.id)}`,
        {
          membershipCategory,
          memberSince: memberSince || null,
          ...Object.fromEntries(PROFILE_FIELDS.map(([, field]) => [field, form[field].trim() || null])),
          description: description.trim() || null,
          contentMarkdown: contentMarkdown.trim() || null,
          links,
          revision: organization.updatedAt,
        },
        organizationDetailResponseSchema,
      );
      toast("Organization updated", "success");
      await onSaved();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="pk-stack" onSubmit={submit}>
      <div class="pk-grid pk-grid--tight">
        <Field label="Membership category" help="This category applies to every active identity for the organization.">
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
        <Field label="Member since">
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
        {PROFILE_FIELDS.map(([label, field]) => (
          <Field key={field} label={label}>
            {(control) => (
              <TextInput
                {...control}
                type={field === "website" || field.endsWith("Url") ? "url" : "text"}
                value={form[field]}
                disabled={busy}
                onInput={(event) =>
                  setForm((current) => ({ ...current, [field]: (event.target as HTMLInputElement).value }))
                }
              />
            )}
          </Field>
        ))}
      </div>

      <Field label="Description">
        {(control) => (
          <Textarea
            {...control}
            rows={2}
            value={description}
            disabled={busy}
            onInput={(event) => setDescription((event.target as HTMLTextAreaElement).value)}
          />
        )}
      </Field>

      <Field label="Content (Markdown)">
        {(control) => (
          <Textarea
            {...control}
            class="pk-mono"
            rows={8}
            value={contentMarkdown}
            disabled={busy}
            onInput={(event) => setContentMarkdown((event.target as HTMLTextAreaElement).value)}
          />
        )}
      </Field>

      <fieldset class="pk-fieldset pk-field">
        <legend class="pk-field__label">Links</legend>
        <ProfileLinksInput
          fieldName="organization.links"
          value={links}
          inputAriaLabel="Organization profile URL"
          onChange={setLinks}
        />
      </fieldset>

      {error && <Alert tone="danger">{friendlyErrorMessage(error)}</Alert>}

      <div class="pk-cluster">
        <Button type="submit" variant="primary" loading={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const CONTACT_FIELDS = [
  ["Primary contact", "primaryContactUserId"],
  ["Secondary contact", "secondaryContactUserId"],
] as const;

/**
 * Who to talk to. Secondary to the record itself, so the page gives it the
 * supporting column rather than a third panel of equal weight.
 */
export function OrganizationContacts({
  organization,
  onSaved,
}: {
  organization: OrganizationDetail;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<(typeof CONTACT_FIELDS)[number][1] | null>(null);
  const [error, setError] = useState("");

  async function update(field: (typeof CONTACT_FIELDS)[number][1], userId: string) {
    setBusy(field);
    setError("");
    try {
      await patchJson(
        `/api/v1/organizations/${encodeURIComponent(organization.id)}`,
        { [field]: userId || null, revision: organization.updatedAt },
        organizationDetailResponseSchema,
      );
      toast("Contact updated", "success");
      await onSaved();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel aria-label="Contacts">
      <PanelHeader title="Contacts" />
      <PanelBody class="pk-stack">
        <div class="pk-grid">
          {CONTACT_FIELDS.map(([label, field]) => (
            <Field key={field} label={label}>
              {(control) => (
                <Select
                  {...control}
                  value={organization[field] ?? ""}
                  disabled={busy !== null}
                  onChange={(event) => void update(field, (event.target as HTMLSelectElement).value)}
                >
                  <option value="">None</option>
                  {organization.identities
                    // One person cannot hold both contact roles; the service
                    // enforces it, the select simply hides the collision.
                    .filter(
                      (representative) =>
                        representative.userId !==
                        organization[
                          field === "primaryContactUserId" ? "secondaryContactUserId" : "primaryContactUserId"
                        ],
                    )
                    .map((representative) => (
                      <option key={representative.userId} value={representative.userId}>
                        {representative.name} ({representative.email})
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          ))}
        </div>
        {error && <Alert tone="danger">{friendlyErrorMessage(error)}</Alert>}
      </PanelBody>
    </Panel>
  );
}

/**
 * A stored URL, rendered as the link it is.
 *
 * `null` comes back as `undefined` rather than as a dash: `DescriptionList`
 * owns what an absent value looks like, and a surface that writes its own dash
 * is the reason the portal had four of them.
 */
function profileLink(url: string | null) {
  if (!url) return undefined;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {url}
    </a>
  );
}

/**
 * The record's facts. A term/value list, not a table: there is one record and
 * no columns to compare across.
 *
 * The membership category is not repeated here — it is a badge beside the
 * organization's name, where the page states what this record is.
 */
function ProfileSummary({ organization }: { organization: OrganizationDetail }) {
  const items: DescriptionListItem[] = [
    { term: "Website", value: profileLink(organization.website) },
    { term: "Slogan", value: organization.slogan },
    { term: "Description", value: organization.description },
    { term: "Blog", value: profileLink(organization.blogUrl) },
    { term: "Press", value: profileLink(organization.pressUrl) },
    { term: "Careers", value: profileLink(organization.careersUrl) },
    // A calendar date, not an instant: the contract is `z.iso.date()`, and
    // `fmt` would widen it into a moment with a time of day and a zone that
    // the value never carried. AGENTS.md forbids that widening explicitly.
    { term: "Member since", value: fmtDate(organization.memberSince) },
    { term: "Created", value: fmt(organization.createdAt) },
  ];

  return <DescriptionList items={items} density="compact" />;
}

export function OrganizationProfile({
  organization,
  canWrite,
  onSaved,
}: {
  organization: OrganizationDetail;
  canWrite: boolean;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  // The panel is the record itself, and nothing else. Contacts used to be
  // rendered from inside here, which meant the page could not decide that one
  // of the two mattered more than the other.
  return (
    <Panel aria-label="Profile">
      <PanelHeader title="Profile">
        {canWrite && !editing && (
          <Button size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </PanelHeader>
      <PanelBody>
        {editing ? (
          <OrganizationProfileForm
            organization={organization}
            onSaved={async () => {
              setEditing(false);
              await onSaved();
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <ProfileSummary organization={organization} />
        )}
      </PanelBody>
    </Panel>
  );
}
