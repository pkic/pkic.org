import { useState } from "preact/hooks";
import {
  badgeIssueRequestSchema,
  badgeIssueResponseSchema,
  badgeAttendeesResponseSchema,
} from "../../../../../../../shared/schemas/route-contracts-event-badges";
import { successResponseSchema } from "../../../../../../../shared/schemas/api-common";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { postJson, deleteJson } from "../../../../../../shared/api-client";
import { UserPicker, type PickedUser } from "../../../../../../components/UserPicker";
import { Field } from "../../../../../../ui/Field";
import { Button } from "../../../../../../ui/Button";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import "./BadgeIssuance.css";
export function BadgeIssuance({ slug }: { slug: string }) {
  const [user, setUser] = useState<PickedUser | null>(null);
  const [badge, setBadge] = useState<{ id: string; credential: string; image: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useContractForm(badgeIssueRequestSchema, { userId: user?.id ?? "" });
  async function issue(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const issued = await postJson(
        `/api/v1/events/${encodeURIComponent(slug)}/badges`,
        checked.data,
        badgeIssueResponseSchema,
      );
      const { default: QR } = await import("qrcode");
      const image = await QR.toDataURL(issued.credential, { width: 512, errorCorrectionLevel: "M", margin: 4 });
      setBadge({ ...issued, image });
    } catch (error) {
      setError(form.refuse(error));
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    if (!badge) return;
    setBusy(true);
    try {
      await deleteJson(`/api/v1/events/${encodeURIComponent(slug)}/badges/${badge.id}`, successResponseSchema);
      setBadge(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not revoke badge.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p>Issue a QR credential for a registered attendee. The printed code contains no name or contact details.</p>
      <form noValidate {...form.handlers} onSubmit={issue}>
        <Field label="Attendee" required {...form.of("userId")}>
          {(control) => (
            <UserPicker
              inputProps={{ ...control, name: "userId" }}
              value={user}
              onChange={setUser}
              endpoint={`/api/v1/events/${encodeURIComponent(slug)}/badges/attendees`}
              responseSchema={badgeAttendeesResponseSchema}
            />
          )}
        </Field>
        <Button type="submit" loading={busy}>
          Create badge QR
        </Button>
      </form>
      {error && <ErrorAlert error={error} />}
      {badge && (
        <>
          <div className="pk-badge-credential">
            <img src={badge.image} alt="Attendee badge QR code" />
            <p>{badge.credential}</p>
          </div>
          <Button type="button" onClick={() => window.print()}>
            Print QR
          </Button>{" "}
          <Button
            type="button"
            variant="danger"
            loading={busy}
            onClick={() => {
              void revoke();
            }}
          >
            Revoke credential
          </Button>
        </>
      )}
    </>
  );
}
