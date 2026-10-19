/**
 * Staff editing one identity's profile where the identity is shown — the
 * speaker on a proposal's roster, say — rather than on the person's record.
 * It reads the identity from its own resource and writes it back there, so
 * what is edited is the identity every record made as it shows, never a copy.
 */
import { useData } from "../../hooks/useData";
import { getJson, patchJson } from "../../shared/api-client";
import { identityRecordSchema } from "../../../shared/schemas/identity-public-profile";
import { ErrorAlert } from "../ErrorAlert";
import { Spinner } from "../Spinner";
import { Button } from "../../ui/Button";
import { IdentityProfileForm } from "./IdentityProfileForm";

/** The identity's staff resource: its profile and its place on the public profile. */
export function identityResourcePath(identityId: string): string {
  return `/api/v1/identities/${encodeURIComponent(identityId)}`;
}

export function IdentityRecordEditor({
  identityId,
  onSaved,
  onCancel,
}: {
  identityId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { data, loading, error } = useData(
    () => getJson(identityResourcePath(identityId), identityRecordSchema),
    [identityId],
  );
  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorAlert error={error} />;
  if (!data) return null;
  return (
    <IdentityProfileForm
      key={data.identityId}
      identity={data}
      editor="staff"
      save={(body) => patchJson(identityResourcePath(data.identityId), body, identityRecordSchema)}
      onSaved={onSaved}
      cancel={
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
      }
    />
  );
}
