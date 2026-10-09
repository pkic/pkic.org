import { formatDateTime } from "../../../../../../../shared/format-date";
import { TextInput } from "../../../../../../ui/TextControl";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { z } from "zod";
import {
  badgeIssueRequestSchema,
  badgeIssueResponseSchema,
  badgeAttendeesResponseSchema,
  badgeCredentialMetadataSchema,
  badgePrintingResponseSchema,
  badgePrintRequestSchema,
  badgePrintResponseSchema,
  type BadgePrintingContext,
  type BadgePrintRequest,
  type BadgeIssueResponse,
} from "../../../../../../../shared/schemas/route-contracts-event-badges";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { getJson, postJson } from "../../../../../../shared/api-client";
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
import { BadgePrintPreview } from "../../../../../../components/event-badges/BadgePrintPreview";
import {
  verifyBadgePrintingContext,
  verifyBadgePrintArtifact,
} from "../../../../../../components/event-badges/badge-print-context";
import { isAuthed, portalSession } from "../../../../state";
import type { PortalSession } from "../../../../types";
import { useSessionExpiry } from "../../../../use-session-expiry";
import type { FreshBadgePrint } from "../../../../../../components/event-badges/badge-print-artifacts";

type CredentialMetadata = z.infer<typeof badgeCredentialMetadataSchema>;

/** Dedicated issuance: only the fresh result holds a printable bearer. */
export function BadgeIssuance({
  slug,
  replacement,
  userId,
  onBack,
  onRecord,
}: {
  slug: string;
  replacement?: CredentialMetadata;
  userId?: string;
  onBack: () => void;
  onRecord: (id: string) => void;
}) {
  useSessionExpiry();
  const session = portalSession.value;
  if (!isAuthed.value || !session) return <ErrorAlert error="Sign in again to create this badge." />;
  return (
    <SessionBadgeIssuance
      key={`${slug}:${session.sessionId}:${session.identity.id}`}
      {...{ slug, replacement, userId, onBack, onRecord }}
      session={session}
    />
  );
}

function SessionBadgeIssuance({
  slug,
  replacement,
  userId,
  onBack,
  onRecord,
  session,
}: {
  slug: string;
  replacement?: CredentialMetadata;
  userId?: string;
  onBack: () => void;
  onRecord: (id: string) => void;
  session: PortalSession;
}) {
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/badges`;
  const request = useMemo(() => new AbortController(), [endpoint, session]);
  useEffect(() => () => request.abort(), [request]);
  const [printing, setPrinting] = useState<BadgePrintingContext | null>(null);
  const [printBody, setPrintBody] = useState<BadgePrintRequest | null>(null);
  const [printResponse, setPrintResponse] = useState<z.output<typeof badgePrintResponseSchema> | null>(null);
  const [printOperationId] = useState(() => crypto.randomUUID());
  function current() {
    return (
      !request.signal.aborted &&
      isAuthed.value &&
      portalSession.value === session &&
      Math.min(Date.parse(session.expiresAt), Date.parse(session.idleExpiresAt)) > Date.now()
    );
  }
  function requireCurrent() {
    if (!current()) throw new Error("Sign in again to prepare this badge.");
  }
  const [user, setUser] = useState<PickedUser | null>(null);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<BadgeIssueResponse | null>(null);
  const [printable, setPrintable] = useState<FreshBadgePrint | null>(null);
  const [expiry, setExpiry] = useState("");
  const [timeZone] = useState(browserTimeZone);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useContractForm(badgeIssueRequestSchema, {
    operationId,
    userId: replacement?.userId ?? userId ?? user?.id ?? "",
    expiresAt: instantFromLocal(expiry, timeZone) ?? undefined,
    ...(replacement ? { replaceBadgeId: replacement.id } : {}),
  });
  async function preparePrint(issued: Extract<BadgeIssueResponse, { result: "issued" }>) {
    requireCurrent();
    const context =
      printing ?? (await getJson(`${endpoint}/printing`, badgePrintingResponseSchema, { signal: request.signal }));
    requireCurrent();
    setPrinting(context);
    const body = badgePrintRequestSchema.parse({ operationId: printOperationId, printingRevision: context.revision });
    const prepared = await postJson(
      `${endpoint}/${encodeURIComponent(issued.id)}/print`,
      body,
      badgePrintResponseSchema,
    );
    requireCurrent();
    if (
      prepared.id !== issued.id ||
      prepared.expiresAt !== issued.expiresAt ||
      prepared.printingRevision !== context.revision ||
      Date.parse(prepared.expiresAt) <= Date.now()
    )
      throw new Error("This badge changed. Open its record to prepare a new print document.");
    setPrintBody(body);
    setPrintResponse(prepared);
    setPrintable({ ...prepared, displayName: prepared.displayName ?? "Attendee", credential: issued.credential });
  }
  async function beforeRelease() {
    if (!printing || !printBody || !printResponse) return false;
    try {
      requireCurrent();
      await verifyBadgePrintingContext(endpoint, printing, request.signal);
      requireCurrent();
      await verifyBadgePrintArtifact(endpoint, printResponse, printBody);
      requireCurrent();
      return true;
    } catch (cause) {
      setPrintable(null);
      if (current()) setError(cause instanceof Error ? cause.message : "Could not verify this print document.");
      return false;
    }
  }
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
      requireCurrent();
      setResult(issued);
      if (issued.result === "issued") {
        await preparePrint(issued);
      }
    } catch (cause) {
      if (current()) setError(form.refuse(cause));
    } finally {
      if (current()) setBusy(false);
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
                { id: "record", label: "View badge", disabled: busy, onSelect: () => onRecord(result.id) },
                { id: "back", label: "Back to badges", disabled: busy, onSelect: onBack },
              ]}
            />
          }
        />
        {result.result !== "issued" ? (
          <Alert tone="info">
            {result.result === "replayed"
              ? "This request was already completed."
              : "This attendee already holds an active badge."}{" "}
            Open View badge to reprint this active badge where available, without changing its code.
          </Alert>
        ) : printable && printing ? (
          <BadgePrintPreview badges={[printable]} printing={printing} beforeRelease={beforeRelease} />
        ) : (
          <div class="pk-stack">
            <Alert tone="info">The badge was created. Keep this page open while preparing its print file.</Alert>
            <Button
              loading={busy}
              onClick={() => {
                setBusy(true);
                void preparePrint(result)
                  .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not prepare print file."))
                  .finally(() => setBusy(false));
              }}
            >
              Prepare print file
            </Button>
          </div>
        )}
        <DescriptionList
          items={[
            { term: "Badge reference", value: result.id },
            { term: "Valid until", value: formatDateTime(result.expiresAt) },
          ]}
        />
        {error && <ErrorAlert error={error} />}
      </div>
    );
  return (
    <div class="pk-stack">
      <PageHeader title={replacement ? "Replace badge" : "Create badge"} />
      <p>
        {replacement
          ? "This replaces only the selected badge. Other badges for this attendee remain valid."
          : "Create an additional badge code for a registered attendee. Existing badges remain valid."}
      </p>
      {replacement && (
        <DescriptionList
          items={[
            { term: "Attendee", value: replacement.displayName ?? "Attendee name unavailable" },
            { term: "Replacing badge", value: replacement.id },
            { term: "Issued", value: formatDateTime(replacement.createdAt) },
          ]}
        />
      )}
      {userId && !replacement && (
        <p>
          This creates an additional badge for the selected registration attendee. It does not replace an existing code.
        </p>
      )}
      <form noValidate {...form.handlers} onSubmit={issue}>
        {!replacement && !userId && (
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
