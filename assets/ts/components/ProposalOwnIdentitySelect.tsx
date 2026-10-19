import { useEffect, useState } from "preact/hooks";
import type { ActingIdentity } from "../../shared/schemas/identity";
import { userAuthSessionResponseSchema } from "../../shared/schemas/user-auth";
import { ApiClientError, getJson } from "../shared/api-client";
import { actingIdentityLabel } from "../shared/acting-identity-catalog";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { SpeakerIdentitySelect } from "./SpeakerIdentitySelect";

/** An editable email never identifies the owner of this private catalog. */
export function ProposalOwnIdentitySelect({
  form,
  onChange,
  onAuthenticated,
}: {
  form: HTMLFormElement;
  onChange: (identity: ActingIdentity | null | undefined) => void;
  onAuthenticated?: (authenticated: boolean) => void;
}) {
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [actorMatches, setActorMatches] = useState(false);
  const [selected, setSelected] = useState<ActingIdentity | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    function actorChanged(): void {
      const contact = form.elements.namedItem("email");
      const speaker = form.elements.namedItem("proposerSpeakerEmail");
      const matches = Boolean(
        ownerEmail &&
        contact instanceof HTMLInputElement &&
        contact.value.trim().toLowerCase() === ownerEmail &&
        (!(speaker instanceof HTMLInputElement) || speaker.value.trim().toLowerCase() === ownerEmail),
      );
      setActorMatches(matches);
      if (!matches) {
        setSelected(undefined);
        onChange(undefined);
      }
    }
    actorChanged();
    form.addEventListener("input", actorChanged);
    form.addEventListener("change", actorChanged);
    return () => {
      form.removeEventListener("input", actorChanged);
      form.removeEventListener("change", actorChanged);
    };
  }, [form, ownerEmail, onChange]);
  async function loadOwnIdentities(silent = false): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const session = await getJson("/api/v1/auth/session", userAuthSessionResponseSchema);
      onAuthenticated?.(true);
      setOwnerEmail(session.identity.email.toLowerCase());
      const email = form.elements.namedItem("email");
      if (email instanceof HTMLInputElement && !email.value) {
        email.value = session.identity.email;
        email.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } catch (caught) {
      onAuthenticated?.(false);
      if (silent && caught instanceof ApiClientError && caught.status === 401) return;
      setError(
        caught instanceof ApiClientError && caught.status === 401
          ? "Sign in through the portal to choose your saved identity, or continue with the form details."
          : "We could not load your identity. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadOwnIdentities(true);
  }, []);
  if (ownerEmail && actorMatches)
    return (
      <SpeakerIdentitySelect
        endpoint="/api/v1/users/current/identities"
        activeOnly
        value={selected === undefined ? undefined : (selected?.id ?? null)}
        selectedLabel={selected ? actingIdentityLabel(selected) : undefined}
        errorSlot="proposer.actingIdentityId"
        onChange={(identity) => {
          setSelected(identity);
          onChange(identity);
        }}
      />
    );
  return (
    <>
      {error && <Alert tone="warn">{error}</Alert>}
      {ownerEmail && !actorMatches && (
        <Alert tone="info">
          Use your signed-in email in your own contact and speaker details to choose your identity.
        </Alert>
      )}
      <Button type="button" variant="secondary" loading={loading} onClick={() => void loadOwnIdentities()}>
        Use my saved identity
      </Button>
    </>
  );
}
