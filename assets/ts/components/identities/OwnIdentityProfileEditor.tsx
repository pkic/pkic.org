/**
 * The owner editing the profile of one identity they hold: job title,
 * biography and links, read from and written to the identity's own-profile
 * resource, so the session keeps acting as the identity it already does.
 */
import { useData } from "../../hooks/useData";
import { getJson, patchJson } from "../../shared/api-client";
import { ownIdentityProfileSchema } from "../../../shared/schemas/own-identity-profile";
import { ErrorAlert } from "../ErrorAlert";
import { Spinner } from "../Spinner";
import { Button } from "../../ui/Button";
import { IdentityProfileForm } from "./IdentityProfileForm";

export const ownIdentityProfilePath = (identityId: string) =>
  `/api/v1/users/current/identities/${encodeURIComponent(identityId)}/profile`;

export function OwnIdentityProfileEditor({
  identityId,
  onSaved,
  onCancel,
}: {
  identityId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { data, loading, error } = useData(
    () => getJson(ownIdentityProfilePath(identityId), ownIdentityProfileSchema),
    [identityId],
  );
  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorAlert error={error} />;
  if (!data) return null;
  return (
    <IdentityProfileForm
      key={data.identityId}
      identity={data}
      editor="owner"
      save={(body) => patchJson(ownIdentityProfilePath(data.identityId), body, ownIdentityProfileSchema)}
      onSaved={onSaved}
      cancel={
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
      }
    />
  );
}
