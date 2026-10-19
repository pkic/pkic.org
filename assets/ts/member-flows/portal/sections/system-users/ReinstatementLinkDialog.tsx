/**
 * Where an emailed reinstatement link lands: the owner's own record, signed
 * in, with this dialog asking them to confirm.
 *
 * Opening the link changes nothing, so a mail scanner that follows it
 * reinstates nothing: reinstating takes the explicit click.
 */
import { useEffect, useState } from "preact/hooks";

import {
  identityMutationResponseSchema,
  identityReinstatementLinkRequestSchema,
  identityReinstatementPreviewResponseSchema,
} from "../../../../../shared/schemas/identity";
import { ApiClientError, postJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { Dialog } from "../../../../ui/Dialog";
import { CURRENT_USER_API } from "./current-user-api";

const ENDPOINT = `${CURRENT_USER_API}/identities/reinstatement`;

function linkError(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403) {
    return "This link was sent to someone else. Sign in with the account it was sent to.";
  }
  if (error instanceof ApiClientError && [404, 409, 410].includes(error.status)) {
    return "This link has expired, was already used, or was replaced by a newer one. Send a new one from your past identities.";
  }
  return error instanceof ApiClientError ? error.message : "Couldn't check this link.";
}

export function ReinstatementLinkDialog({
  token,
  onReinstated,
  onClose,
}: {
  token: string;
  onReinstated: () => Promise<void>;
  onClose: () => void;
}) {
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    postJson(`${ENDPOINT}/preview`, { token }, identityReinstatementPreviewResponseSchema)
      .then((preview) => !cancelled && setOrganizationName(preview.organizationName))
      .catch((reason: unknown) => !cancelled && setError(linkError(reason)));
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function reinstate(): Promise<void> {
    setSaving(true);
    setError("");
    try {
      await postJson(
        `${ENDPOINT}/confirmation`,
        identityReinstatementLinkRequestSchema.parse({ token }),
        identityMutationResponseSchema,
      );
      await onReinstated();
      onClose();
    } catch (reason) {
      setError(linkError(reason));
    } finally {
      setSaving(false);
    }
  }

  const organization = organizationName ?? "the organization";
  return (
    <Dialog
      open
      title={`Reinstate your representation of ${organization}?`}
      description="The end date is removed, as if the representation never ended."
      consequences={[
        `Your permissions and roles through ${organization} return`,
        `Your group seats for ${organization} reopen`,
      ]}
      closeLabel="Close reinstate representation"
      confirmLabel={saving ? "Reinstating…" : "Reinstate"}
      confirmDisabled={saving || organizationName === null}
      onConfirm={() => void reinstate()}
      onCancel={() => {
        if (!saving) onClose();
      }}
    >
      {error && <Alert tone="danger">{error}</Alert>}
    </Dialog>
  );
}
