/**
 * My Profile — edit. Editable fields: first
 * name, last name, preferred name, and identity-owned profile fields.
 * Headshot upload and the organization-page
 * visibility toggle live in the same tab nav table.
 */
import { useRef, useState } from "preact/hooks";
import { getJson, patchJson, postJson, putJson, ApiClientError } from "../../../shared/api-client";
import { AdminHeadshotManager } from "../../../shared/headshot/AdminHeadshotManager";
import { replaceFile } from "../../../shared/file-upload";
import { friendlyErrorMessage } from "../../../components/ErrorAlert";
import { Alert } from "../../../ui/Alert";
import { Badge } from "../../../ui/Badge";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { PersonCell } from "../../../ui/PersonCell";
import { Spinner } from "../../../ui/Spinner";
import { Select, Textarea, TextInput } from "../../../ui/TextControl";
import { profile as profileSignal, saveProfile } from "../state";
import { toast } from "../ui";
import type { MyProfile as MyProfileType, MyProfileUpdateInput } from "../types";
import { linksToText, textToLinks } from "../../../shared/links-text";
import { myProfileSchema, myHeadshotUploadResponseSchema } from "../../../../shared/schemas/me";
import { identityMutationResponseSchema } from "../../../../shared/schemas/identity";
import type { ApiTableActions } from "../../../components/ApiDataTable";
import { ActingIdentityDirectory } from "./OrganizationIdentityDirectory";
import "../../../ui/Content.css";

const CURRENT_USER_API = "/api/v1/users/current";

async function refreshProfile(): Promise<void> {
  const refreshed = await getJson(CURRENT_USER_API, myProfileSchema);
  saveProfile(refreshed);
}

/** The name the member is known by, falling back through what they have filled in. */
function displayName(current: MyProfileType): string {
  const full = [current.firstName, current.lastName].filter(Boolean).join(" ").trim();
  return current.preferredName?.trim() || full || current.email;
}

export function MyProfile() {
  const current = profileSignal.value;
  const [form, setForm] = useState(() => ({
    firstName: current?.firstName ?? "",
    lastName: current?.lastName ?? "",
    preferredName: current?.preferredName ?? "",
    emailId: current?.emailId ?? "",
    jobTitle: current?.jobTitle ?? "",
    biography: current?.biography ?? "",
    linksText: linksToText(current?.links ?? []),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibilitySaving, setVisibilitySaving] = useState(false);

  if (!current) return <Spinner label="Loading your profile…" />;

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const input: MyProfileUpdateInput = {
        firstName: form.firstName.trim() || undefined,
        lastName: form.lastName.trim() || undefined,
        preferredName: form.preferredName.trim(),
        biography: form.biography.trim(),
        links: textToLinks(form.linksText),
      };
      if (current!.organizationId) {
        input.emailId = form.emailId || null;
        input.jobTitle = form.jobTitle.trim();
      }
      const updated = await patchJson(CURRENT_USER_API, input, myProfileSchema);
      saveProfile(updated);
      toast("Profile updated", "success");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not update your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleVisibilityToggle(next: boolean): Promise<void> {
    setVisibilitySaving(true);
    try {
      saveProfile(await patchJson(CURRENT_USER_API, { showOnOrgProfile: next }, myProfileSchema));
      toast(
        next
          ? "You'll now appear on your organization's public page"
          : "You're now hidden from your organization's public page",
        "success",
      );
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Could not update visibility.", "error");
    } finally {
      setVisibilitySaving(false);
    }
  }

  return (
    <div class="pk pk-grid pk-grid--roomy content-width-lg">
      <div class="pk-stack">
        <Panel>
          <PanelBody>
            <AdminHeadshotManager
              initialUrl={current.headshotUrl}
              alt={current.email}
              emptyLabel="You"
              uploadLabel="📷 Upload headshot"
              helpText="JPEG, PNG, or WebP, up to 5MB."
              uploadHeadshot={async (file) => {
                await replaceFile(`${CURRENT_USER_API}/headshot`, file, myHeadshotUploadResponseSchema);
                await refreshProfile();
                return { headshotUrl: profileSignal.value?.headshotUrl };
              }}
            />
          </PanelBody>
        </Panel>

        {current.organizationId && (
          <Panel>
            <PanelBody>
              <label class="pk-check">
                <input
                  class="pk-check__input"
                  type="checkbox"
                  role="switch"
                  checked={current.showOnOrgProfile}
                  disabled={visibilitySaving}
                  onChange={(e) => void handleVisibilityToggle((e.target as HTMLInputElement).checked)}
                />
                <span class="pk-check__label">
                  Show my name, job title, and bio on {current.organizationName ?? "my organization"}'s public page
                </span>
              </label>
            </PanelBody>
          </Panel>
        )}

        {current.activeIdentities.length > 1 && <ActiveIdentitySwitcher current={current} />}
      </div>

      <div class="pk-stack">
        <Panel>
          <PanelBody>
            <form
              class="pk-stack"
              onSubmit={(e) => {
                void handleSubmit(e);
              }}
            >
              <div class="pk-grid pk-grid--tight">
                <Field label="First name" required>
                  {(control) => (
                    <TextInput
                      {...control}
                      value={form.firstName}
                      onInput={(e) => setForm((f) => ({ ...f, firstName: (e.target as HTMLInputElement).value }))}
                    />
                  )}
                </Field>
                {current.organizationId && (
                  <Field
                    label="Email for this organization"
                    help="Used for your profile and actions in this organization capacity."
                  >
                    {(control) => (
                      <Select
                        {...control}
                        value={form.emailId}
                        onChange={(e) => setForm((f) => ({ ...f, emailId: (e.target as HTMLSelectElement).value }))}
                      >
                        {current.emailAddresses.map((address) => (
                          <option value={address.id ?? ""} key={address.id ?? "primary"}>
                            {address.email}
                            {address.primary ? " (primary)" : ""}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                )}
                <Field label="Last name" required>
                  {(control) => (
                    <TextInput
                      {...control}
                      value={form.lastName}
                      onInput={(e) => setForm((f) => ({ ...f, lastName: (e.target as HTMLInputElement).value }))}
                    />
                  )}
                </Field>
                <Field label="Preferred name">
                  {(control) => (
                    <TextInput
                      {...control}
                      value={form.preferredName}
                      onInput={(e) => setForm((f) => ({ ...f, preferredName: (e.target as HTMLInputElement).value }))}
                      placeholder="Shown instead of first/last name if set"
                    />
                  )}
                </Field>
                {current.organizationId && (
                  <Field label="Job title for this organization">
                    {(control) => (
                      <TextInput
                        {...control}
                        value={form.jobTitle}
                        onInput={(e) => setForm((f) => ({ ...f, jobTitle: (e.target as HTMLInputElement).value }))}
                      />
                    )}
                  </Field>
                )}
              </div>

              <Field label="Biography">
                {(control) => (
                  <Textarea
                    {...control}
                    rows={5}
                    value={form.biography}
                    onInput={(e) => setForm((f) => ({ ...f, biography: (e.target as HTMLTextAreaElement).value }))}
                  />
                )}
              </Field>

              <Field label="Social / profile links">
                {(control) => (
                  <Textarea
                    {...control}
                    rows={3}
                    placeholder="One URL per line"
                    value={form.linksText}
                    onInput={(e) => setForm((f) => ({ ...f, linksText: (e.target as HTMLTextAreaElement).value }))}
                  />
                )}
              </Field>

              {error && <Alert tone="danger">{friendlyErrorMessage(error)}</Alert>}

              <div class="pk-cluster">
                <Button type="submit" variant="primary" loading={saving}>
                  {saving ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </form>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Membership" />
          <PanelBody class="pk-stack pk-stack--snug">
            <PersonCell name={displayName(current)} avatarSrc={current.headshotUrl ?? undefined} />
            <dl class="pk-datalist pk-small">
              <dt>Email in this capacity</dt>
              <dd>{current.email}</dd>
              <dt>Membership category</dt>
              <dd>{current.membershipCategory}</dd>
              <dt>Member since</dt>
              <dd>{new Date(current.memberSince).toLocaleDateString()}</dd>
            </dl>
          </PanelBody>
        </Panel>

        {current.organizationIdentities && <OrganizationIdentitiesCard current={current} />}
      </div>
    </div>
  );
}

function OrganizationIdentitiesCard({ current }: { current: MyProfileType }) {
  const directoryRef = useRef<ApiTableActions | null>(null);
  const [showAddCoworker, setShowAddCoworker] = useState(false);

  if (!current.organizationId || !current.organizationIdentities) return null;
  const primaryContactUserId = current.organizationIdentities.find((identity) => identity.isPrimaryContact)?.userId;

  return (
    <Panel>
      <PanelHeader title="Organization identities" />
      <PanelBody class="pk-stack pk-stack--snug">
        {current.isOrgContact && showAddCoworker && (
          <AddCoworkerForm
            organizationId={current.organizationId}
            onCancel={() => setShowAddCoworker(false)}
            onAdded={async () => {
              setShowAddCoworker(false);
              await refreshProfile();
              await directoryRef.current?.reload();
            }}
          />
        )}
        <ActingIdentityDirectory
          organizationId={current.organizationId}
          activeIdentities={current.organizationIdentities}
          canManage={current.isOrgContact}
          canBlock={(userId) => userId !== current.userId && userId !== primaryContactUserId}
          onChanged={refreshProfile}
          actionsRef={directoryRef}
          createAction={
            current.isOrgContact ? { label: "Add coworker", onSelect: () => setShowAddCoworker(true) } : undefined
          }
        />
      </PanelBody>
    </Panel>
  );
}

/**
 * Only rendered when the caller represents more than one organization (or
 * an organization plus their own individual membership) concurrently —
 * lets them pick which membership context the rest of the portal (working
 * groups, votes, applications, etc.) acts as. Switching reissues the
 * session cookie server-side (PUT /api/v1/users/current/identities/active) and then
 * does a full navigation rather than a signal update, so every other
 * org-scoped screen re-fetches under the new context instead of holding
 * stale state from the previous one.
 */
function ActiveIdentitySwitcher({ current }: { current: MyProfileType }) {
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The currently-active entry is whichever membership matches the
  // organization (or org-less-ness) the rest of this profile response is
  // already scoped to.
  const activeIdentityId = current.activeIdentities.find(
    (identity) => identity.organizationId === current.organizationId,
  )?.identityId;

  async function handleSwitch(identityId: string): Promise<void> {
    if (identityId === activeIdentityId) return;
    setError(null);
    setSwitching(identityId);
    try {
      await putJson(`${CURRENT_USER_API}/identities/active`, { identityId }, myProfileSchema);
      // A full reload, not window.location.assign to this same route — the
      // caller is already on #/profile, so assigning that same URL is a
      // no-op and would leave every other org-scoped screen (working
      // groups, votes, applications) holding state from the org context
      // just switched away from.
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not switch membership. Please try again.");
      setSwitching(null);
    }
  }

  return (
    <Panel>
      <PanelHeader title="Acting as" />
      <PanelBody class="pk-stack pk-stack--snug">
        <p class="pk-muted pk-small">
          You hold more than one active identity. Switch which exact identity the portal acts as below.
        </p>
        <ul class="pk-stack pk-stack--tight">
          {current.activeIdentities.map((identity) => {
            const isActive = identity.identityId === activeIdentityId;
            return (
              <li key={identity.identityId} class="pk-cluster pk-cluster--between">
                <span>
                  {identity.organizationName ?? "My individual identity"}{" "}
                  <span class="pk-muted pk-small">({identity.membershipCategory})</span>
                </span>
                {isActive ? (
                  <Badge tone="ok">Current</Badge>
                ) : (
                  <Button
                    size="sm"
                    disabled={switching !== null}
                    onClick={() => void handleSwitch(identity.identityId)}
                  >
                    {switching === identity.identityId ? "Switching…" : "Switch"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {error && <Alert tone="danger">{friendlyErrorMessage(error)}</Alert>}
      </PanelBody>
    </Panel>
  );
}

function AddCoworkerForm({
  organizationId,
  onAdded,
  onCancel,
}: {
  organizationId: string;
  onAdded: () => Promise<void>;
  onCancel: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
    const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
    if (!name || !email) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await postJson(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/identities`,
        {
          userReference: "email",
          name,
          email,
          activation: { mode: "invitation" },
          showOnOrganizationProfile: true,
        },
        identityMutationResponseSchema,
      );
      setSuccess(`${name} (${email}) was invited to accept an identity for your organization.`);
      form.reset();
      await onAdded();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not add this coworker. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="pk-stack pk-stack--snug">
      <div class="pk-cluster pk-cluster--between">
        <h4>Add a coworker</h4>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <form
        class="pk-stack pk-stack--snug"
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
      >
        <div class="pk-grid pk-grid--tight">
          <Field label="Name" required>
            {(control) => <TextInput {...control} type="text" name="name" />}
          </Field>
          <Field label="Email" required>
            {(control) => <TextInput {...control} type="email" name="email" />}
          </Field>
        </div>
        <div class="pk-cluster">
          <Button type="submit" variant="primary" size="sm" loading={submitting}>
            {submitting ? "Adding…" : "Add coworker"}
          </Button>
        </div>
      </form>
      {success && <Alert tone="ok">{success}</Alert>}
      {error && <Alert tone="danger">{friendlyErrorMessage(error)}</Alert>}
    </div>
  );
}
