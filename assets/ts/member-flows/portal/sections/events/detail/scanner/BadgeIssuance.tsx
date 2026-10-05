import { formatDateTime } from "../../../../../../../shared/format-date";
import { TextInput } from "../../../../../../ui/TextControl";
import { useState } from "preact/hooks";
import type { z } from "zod";
import {
  badgeIssueRequestSchema,
  badgeIssueResponseSchema,
  badgeAttendeesResponseSchema,
  type badgeCredentialMetadataSchema,
  type BadgeIssueResponse,
} from "../../../../../../../shared/schemas/route-contracts-event-badges";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { postJson } from "../../../../../../shared/api-client";
import { UserPicker, type PickedUser } from "../../../../../../components/UserPicker";
import { instantFromLocal } from "../../../../../../components/forms/SubmissionWindowFields";
import { browserTimeZone } from "../../../../ui";
import { Field } from "../../../../../../ui/Field";
import { Button } from "../../../../../../ui/Button";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { PageHeader } from "../../../../../../ui/PageHeader";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { Menu } from "../../../../../../ui/Menu";
import { Alert } from "../../../../../../ui/Alert";
import "./BadgeIssuance.css";

type CredentialMetadata = z.infer<typeof badgeCredentialMetadataSchema>;

/** Dedicated issuance: only the fresh result holds a printable bearer. */
export function BadgeIssuance({
  slug,
  replacement,
  onBack,
  onRecord,
}: {
  slug: string;
  replacement?: CredentialMetadata;
  onBack: () => void;
  onRecord: (id: string) => void;
}) {
  const [user, setUser] = useState<PickedUser | null>(null);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<BadgeIssueResponse | null>(null);
  const [image, setImage] = useState("");
  const [expiry, setExpiry] = useState("");
  const [timeZone] = useState(browserTimeZone);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useContractForm(badgeIssueRequestSchema, {
    operationId,
    userId: replacement?.userId ?? user?.id ?? "",
    expiresAt: instantFromLocal(expiry, timeZone) ?? undefined,
    ...(replacement ? { replaceBadgeId: replacement.id } : {}),
  });
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
      setResult(issued);
      if (issued.result === "issued") {
        const { default: QR } = await import("qrcode");
        setImage(await QR.toDataURL(issued.credential, { width: 512, errorCorrectionLevel: "M", margin: 4 }));
      }
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setBusy(false);
    }
  }
  if (result)
    return (
      <div class="pk-stack">
        <PageHeader
          title={replacement ? "Badge replaced" : "Badge created"}
          actions={
            <Menu
              label="Badge actions"
              items={[
                ...(result.result === "issued"
                  ? [{ id: "print", label: "Print QR", disabled: !image || busy, onSelect: () => window.print() }]
                  : []),
                { id: "record", label: "View credential", onSelect: () => onRecord(result.id) },
                { id: "back", label: "Back to badges", onSelect: onBack },
              ]}
            />
          }
        />
        {result.result === "replayed" ? (
          <Alert tone="info">
            This request was already completed. The printable code is available only when a badge is first issued. Open
            its record and explicitly replace it if you need a new printable code.
          </Alert>
        ) : (
          <div class="pk-badge-credential">
            {image && <img src={image} alt="Attendee badge QR code" />}
            <p>{result.credential}</p>
            <p>Print this code now. It cannot be retrieved after leaving this page.</p>
          </div>
        )}
        <DescriptionList
          items={[
            { term: "Credential reference", value: result.id },
            { term: "Valid until", value: formatDateTime(result.expiresAt) },
          ]}
        />
        {error && <ErrorAlert error={error} />}
      </div>
    );
  return (
    <div class="pk-stack">
      <PageHeader title={replacement ? "Replace badge credential" : "Create badge"} />
      <p>
        {replacement
          ? "This replaces only the selected credential. Other badges for this attendee remain valid."
          : "Create an additional QR credential for a registered attendee. Existing credentials remain valid."}
      </p>
      {replacement && (
        <DescriptionList
          items={[
            { term: "Attendee", value: replacement.displayName ?? "Attendee name unavailable" },
            { term: "Replacing credential", value: replacement.id },
            { term: "Issued", value: formatDateTime(replacement.createdAt) },
          ]}
        />
      )}
      <form noValidate {...form.handlers} onSubmit={issue}>
        {!replacement && (
          <Field label="Attendee" required {...form.of("userId")}>
            {(control) => (
              <UserPicker
                inputProps={{ ...control, name: "userId" }}
                value={user}
                disabled={busy}
                onChange={(next) => {
                  if (next?.id !== user?.id) setOperationId(crypto.randomUUID());
                  setUser(next);
                }}
                endpoint={`/api/v1/events/${encodeURIComponent(slug)}/badges/attendees`}
                responseSchema={badgeAttendeesResponseSchema}
              />
            )}
          </Field>
        )}
        <Field
          label="Badge expiry"
          help={`Your time (${timeZone}). Defaults to the event end, or 24 hours for an event without an end. Set a future expiry to extend an ended event.`}
          {...form.of("expiresAt")}
        >
          {(control) => (
            <TextInput
              {...control}
              type="datetime-local"
              name="expiresAt"
              value={expiry}
              disabled={busy}
              onInput={(event) => {
                const next = event.currentTarget.value;
                if (next !== expiry) setOperationId(crypto.randomUUID());
                setExpiry(next);
              }}
            />
          )}
        </Field>
        {error && <ErrorAlert error={error} />}
        <div class="pk-cluster">
          <Button type="submit" loading={busy}>
            {replacement ? "Replace badge QR" : "Create badge QR"}
          </Button>
          <Button type="button" disabled={busy} onClick={onBack}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
