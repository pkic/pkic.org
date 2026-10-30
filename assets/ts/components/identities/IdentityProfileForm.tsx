/**
 * The edit of one identity's profile: the notice that records made as the
 * identity show the change, the shared fields, and Save. Its owner edits it
 * from their professional profile and staff from wherever the identity is
 * shown, such as the speaker it is on a proposal's roster — the same form,
 * held to the same contract. The caller names the identity's resource through
 * `save`, because the owner and staff reach the identity through different
 * authority.
 */
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { useContractForm } from "../../hooks/useContractForm";
import { identityProfileUpdateSchema, type IdentityProfileUpdate } from "../../../shared/schemas/own-identity-profile";
import { withOrganizationJobTitle } from "../../../shared/schemas/identity-job-title";
import { friendlyErrorMessage } from "../ErrorAlert";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import {
  IdentityEditNotice,
  IdentityProfileFields,
  identityProfileBody,
  identityProfileDraft,
  type IdentityProfileDraft,
} from "./IdentityProfileFields";

export interface EditableIdentity {
  organizationId: string | null;
  organizationName?: string | null;
  jobTitle: string | null;
  biography: string | null;
  links: readonly string[];
}

export function IdentityProfileForm({
  identity,
  editor,
  purpose = "profile",
  save,
  onSaved,
  cancel,
}: {
  identity: EditableIdentity;
  /** Who edits: the owner is told how to report a changed affiliation, staff whose records change. */
  editor: "owner" | "staff";
  purpose?: "profile" | "speaker";
  /** Stores the checked edit on the identity's resource. */
  save: (body: IdentityProfileUpdate) => Promise<unknown>;
  onSaved: () => void;
  /** The way back without saving: a link to the page it came from, or a button that closes it. */
  cancel: ComponentChildren;
}) {
  const [draft, setDraft] = useState<IdentityProfileDraft>(() => identityProfileDraft(identity));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Checked by the contract the route parses, live and on submit.
  const form = useContractForm(
    withOrganizationJobTitle(identityProfileUpdateSchema, {
      organization: identity.organizationId !== null,
      jobTitle: identity.jobTitle,
    }),
    identityProfileBody(draft, identity.organizationId !== null),
  );

  async function submit(event: Event) {
    event.preventDefault();
    setError(null);
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.formMessage);
      return;
    }
    setSaving(true);
    try {
      await save(checked.data);
      onSaved();
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      noValidate
      class="pk-stack"
      {...form.handlers}
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <IdentityEditNotice editor={editor} />
      <IdentityProfileFields
        draft={draft}
        onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        of={form.of}
        organizationId={identity.organizationId}
        organizationName={identity.organizationName}
        purpose={purpose}
      />
      {error && <Alert tone="danger">{friendlyErrorMessage(error)}</Alert>}
      <div class="pk-cluster">
        <Button type="submit" variant="primary" loading={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        {cancel}
      </div>
    </form>
  );
}
