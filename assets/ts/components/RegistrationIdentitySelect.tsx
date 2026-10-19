import { useEffect, useState } from "preact/hooks";
import { identitiesListResponseSchema, type ActingIdentity } from "../../shared/schemas/identity";
import { REGISTRATION_IDENTITY_COPY as copy } from "../../shared/email-first-copy";
import { getJson } from "../shared/api-client";
import { buildServerCollectionUrl } from "../hooks/useServerCollection";
import { actingIdentityCatalog } from "../shared/acting-identity-catalog";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { ServerSearchSelect } from "./ServerSearchSelect";

const identityLabel = (identity: ActingIdentity) => identity.organizationName ?? "My individual membership";
const catalog = actingIdentityCatalog("/api/v1/users/current/identities", identityLabel);

/** The signed-in person's identities, filtered on the server; one row is enough to decide what to offer. */
export function currentIdentitiesUrl(params: Record<string, string> = {}): string {
  return buildServerCollectionUrl(catalog.endpoint, {
    ...catalog.params,
    ...params,
    limit: "1",
    offset: "0",
    sort: catalog.sort,
  });
}

/**
 * The identity a registration is made as. An identity under the address the
 * person continued with is shown read-only — its organization comes from the
 * identity, never from a typed answer — with a way to choose another one they
 * already hold; without one, the registration shows their current affiliation.
 */
export function RegistrationIdentityField({ preferred }: { preferred?: ActingIdentity | null }) {
  const [selected, setSelected] = useState<ActingIdentity | null>(preferred ?? null);
  const [choosing, setChoosing] = useState(!preferred);
  const hidden = <input type="hidden" name="identityId" value={selected?.id ?? ""} />;
  if (!choosing && selected?.organizationName)
    return (
      <div class="pk-stack pk-stack--snug">
        <p>{copy.representing(selected.organizationName)}</p>
        <div>
          <Button type="button" variant="link" onClick={() => setChoosing(true)}>
            {copy.chooseOther}
          </Button>
        </div>
        {hidden}
      </div>
    );
  return (
    <Field
      label="Event identity"
      help="Optional. Your registration shows the organization and job title of the identity you choose; without one it shows your current affiliation."
    >
      {(control) => (
        <>
          <ServerSearchSelect
            {...control}
            catalog={catalog}
            searchLabel="Your identities"
            value={selected?.id ?? null}
            selectedLabel={selected ? identityLabel(selected) : undefined}
            placeholder="Use my current affiliation"
            onChange={setSelected}
          />
          {hidden}
        </>
      )}
    </Field>
  );
}

/** Optional attribution for a signed-in registration. Opening the form never selects or activates an identity. */
export function RegistrationIdentitySelect() {
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selectable, setSelectable] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    getJson(currentIdentitiesUrl(), identitiesListResponseSchema)
      .then((available) => {
        if (!active) return;
        setSelectable(
          available.page.total > 1 ||
            (available.identities[0] !== undefined && available.identities[0].organizationId !== null),
        );
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  if (loading) return <p role="status">Loading your identities…</p>;
  if (failed)
    return (
      <>
        <Alert tone="warn">
          We could not load your identities. You can try again or register with your current affiliation.
        </Alert>
        <Button type="button" variant="secondary" onClick={() => setAttempt((current) => current + 1)}>
          Try again
        </Button>
      </>
    );
  return selectable ? <RegistrationIdentityField /> : null;
}
