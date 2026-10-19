/**
 * The identity invitations waiting for the signed-in person to accept.
 *
 * Rendered only while at least one is pending: an empty panel would say
 * nothing and take room from the record.
 */
import { useEffect, useState } from "preact/hooks";
import {
  identitiesListResponseSchema,
  identityMutationResponseSchema,
  type ActingIdentity,
} from "../../../../../shared/schemas/identity";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { ApiClientError, getJson, patchJson } from "../../../../shared/api-client";
import { Button } from "../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { RowList, RowListItem } from "../../../../ui/RowList";
import { toast } from "../../ui";

export function IdentityInvitationsPanel() {
  const [invitations, setInvitations] = useState<ActingIdentity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);

  useEffect(() => {
    getJson("/api/v1/users/current/identities?active=false&limit=100", identitiesListResponseSchema)
      .then((response) => setInvitations(response.identities.filter((identity) => identity.state === "pending")))
      .catch((reason: unknown) =>
        setError(reason instanceof ApiClientError ? reason.message : "Could not load identity invitations."),
      );
  }, []);

  async function accept(identity: ActingIdentity): Promise<void> {
    setAccepting(identity.id);
    try {
      await patchJson(
        `/api/v1/users/current/identities/${encodeURIComponent(identity.id)}`,
        { transition: { state: "active" } },
        identityMutationResponseSchema,
      );
      toast(`Identity for ${identity.organizationName ?? "the organization"} accepted`, "success");
      window.location.reload();
    } catch (reason) {
      toast(reason instanceof ApiClientError ? reason.message : "Could not accept the identity invitation.", "error");
      setAccepting(null);
    }
  }

  if (error) return <ErrorAlert error={error} />;
  if (!invitations || invitations.length === 0) return null;

  return (
    <Panel aria-label="Identity invitations">
      <PanelHeader title="Identity invitations" headingLevel={2} />
      <PanelBody flush>
        <RowList label="Identity invitations">
          {invitations.map((identity) => (
            <RowListItem
              key={identity.id}
              meta="Accept to receive Member and group access in this exact capacity."
              end={
                <Button variant="primary" disabled={accepting !== null} onClick={() => void accept(identity)}>
                  {accepting === identity.id ? "Accepting…" : "Accept identity"}
                </Button>
              }
            >
              <strong>{identity.organizationName}</strong>
            </RowListItem>
          ))}
        </RowList>
      </PanelBody>
    </Panel>
  );
}
