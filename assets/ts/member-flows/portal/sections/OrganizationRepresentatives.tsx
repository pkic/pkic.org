/**
 * The people who act for an organization, on the organization's own page.
 *
 * This roster used to hang off "My profile", which put a list of coworkers on
 * a page about one person. Who represents an organization is a fact about the
 * organization, so it reads here, next to the profile they all speak through —
 * the same list, from the same shared directory, that the staff organization
 * record shows under "Representatives".
 *
 * The directory it renders is the acting membership's own roster, so it is
 * shown only while the page is that membership's organization; another
 * represented organization's roster is not in the profile response this reads.
 */
import { useRef, useState } from "preact/hooks";
import { usePortalHashLocation } from "../hash-location";
import { getJson, postJson } from "../../../shared/api-client";
import { friendlyErrorMessage } from "../../../components/ErrorAlert";
import type { ApiTableActions } from "../../../components/ApiDataTable";
import { Alert } from "../../../ui/Alert";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { TextInput } from "../../../ui/TextControl";
import { useContractForm } from "../../../hooks/useContractForm";
import { identityCreateSchema, identityMutationResponseSchema } from "../../../../shared/schemas/identity";
import { myProfileSchema } from "../../../../shared/schemas/me";
import { profile as profileSignal, saveProfile } from "../state";
import type { MyProfile } from "../types";
import { ActingIdentityDirectory } from "./OrganizationIdentityDirectory";

/** The reserved segment under an organization that routes to the add page. */
export const ADD_REPRESENTATIVE_SEGMENT = "new";

/** Re-reads the profile the roster is drawn from, after it changes. */
async function refreshProfile(): Promise<void> {
  saveProfile(await getJson("/api/v1/users/current", myProfileSchema));
}

/** The organization page the roster reads on. */
function organizationHref(organizationId: string): string {
  return `/organizations/${encodeURIComponent(organizationId)}`;
}

export function OrganizationRepresentatives({
  organizationId,
  representativeSegment,
}: {
  organizationId: string;
  /** Present while the add page stands in place of the roster. */
  representativeSegment?: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const directoryRef = useRef<ApiTableActions | null>(null);
  const profile: MyProfile | null = profileSignal.value;

  // Only the acting membership's own organization has a roster in this
  // response; anything else is a page the member represents but is not
  // currently acting for.
  if (!profile?.organizationIdentities || profile.organizationId !== organizationId) return null;

  const primaryContactUserId = profile.organizationIdentities.find((identity) => identity.isPrimaryContact)?.userId;

  if (representativeSegment === ADD_REPRESENTATIVE_SEGMENT && profile.isOrgContact) {
    // The add page supplies its own heading and way back, and stands in place
    // of the directory it adds to rather than above it.
    return (
      <AddRepresentativeForm
        organizationId={organizationId}
        onCancel={() => navigate(organizationHref(organizationId))}
        onAdded={async () => {
          navigate(organizationHref(organizationId));
          await refreshProfile();
        }}
      />
    );
  }

  return (
    <Panel>
      <PanelHeader title="Representatives" />
      <PanelBody class="pk-stack pk-stack--snug">
        <ActingIdentityDirectory
          organizationId={organizationId}
          activeIdentities={profile.organizationIdentities}
          canManage={profile.isOrgContact}
          canBlock={(userId) => userId !== profile.userId && userId !== primaryContactUserId}
          onChanged={refreshProfile}
          actionsRef={directoryRef}
          createAction={
            profile.isOrgContact
              ? {
                  label: "Add coworker",
                  onSelect: () =>
                    navigate(`${organizationHref(organizationId)}/representatives/${ADD_REPRESENTATIVE_SEGMENT}`),
                }
              : undefined
          }
        />
      </PanelBody>
    </Panel>
  );
}

function AddRepresentativeForm({
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

  /*
   * The same contract the route parses. The draft used to be read back out of
   * the DOM with `form.elements.namedItem` and checked with `if (!name ||
   * !email) return` — a hand-written rule that silently did nothing, so a
   * reader who left a field blank got no field marked and no message.
   */
  const [draft, setDraft] = useState({ name: "", email: "" });
  const form = useContractForm(identityCreateSchema, {
    userReference: "email",
    name: draft.name.trim(),
    email: draft.email.trim(),
    activation: { mode: "invitation" },
    showOnOrganizationProfile: true,
  });

  async function handleSubmit(event: Event): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setSubmitting(true);
    try {
      await postJson(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/identities`,
        checked.data,
        identityMutationResponseSchema,
      );
      setSuccess(
        `${draft.name.trim()} (${draft.email.trim()}) was invited to accept an identity for your organization.`,
      );
      setDraft({ name: "", email: "" });
      await onAdded();
    } catch (cause) {
      // A server refusal names its fields the way the contract does.
      setError(form.refuse(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="pk pk-stack">
      {/* The page's way back: adding has its own address, so leaving it is
          navigation rather than the disappearance of a layer. */}
      <div class="pk-cluster">
        <Button size="sm" onClick={onCancel} disabled={submitting}>
          ← Representatives
        </Button>
      </div>
      <Panel aria-label="Add a coworker">
        <PanelHeader title="Add a coworker" headingLevel={2} />
        <PanelBody>
          <form
            noValidate
            class="pk-stack pk-stack--snug"
            {...form.handlers}
            onSubmit={(event) => {
              void handleSubmit(event);
            }}
          >
            <div class="pk-grid pk-grid--tight">
              <Field label="Name" required {...form.of("name")}>
                {(control) => (
                  <TextInput
                    {...control}
                    type="text"
                    name="name"
                    value={draft.name}
                    onInput={(event) => setDraft((current) => ({ ...current, name: event.currentTarget.value }))}
                  />
                )}
              </Field>
              <Field label="Email" required {...form.of("email")}>
                {(control) => (
                  <TextInput
                    {...control}
                    type="email"
                    name="email"
                    value={draft.email}
                    onInput={(event) => setDraft((current) => ({ ...current, email: event.currentTarget.value }))}
                  />
                )}
              </Field>
            </div>
            <div class="pk-cluster">
              <Button type="submit" variant="primary" size="sm" loading={submitting}>
                {submitting ? "Adding…" : "Add coworker"}
              </Button>
              <Button size="sm" onClick={onCancel} disabled={submitting}>
                Cancel
              </Button>
            </div>
          </form>
          {success && <Alert tone="ok">{success}</Alert>}
          {error && <Alert tone="danger">{friendlyErrorMessage(error)}</Alert>}
        </PanelBody>
      </Panel>
    </div>
  );
}
