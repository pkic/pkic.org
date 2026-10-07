import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  badgeCredentialMetadataSchema,
  badgePrintRequestSchema,
  badgePrintResponseSchema,
} from "../../../../../../../shared/schemas/route-contracts-event-badges";
import { BadgePrintPreview } from "../../../../../../components/event-badges/BadgePrintPreview";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../components/Spinner";
import { useData } from "../../../../../../hooks/useData";
import { getJson, requestJson } from "../../../../../../shared/api-client";
import { Button } from "../../../../../../ui/Button";
import { PageHeader } from "../../../../../../ui/PageHeader";
import { isAuthed, portalSession } from "../../../../state";
import type { PortalSession } from "../../../../types";
import { useSessionExpiry } from "../../../../use-session-expiry";
import type { z } from "zod";

/** Route and session changes discard the private artifact; metadata never restores it. */
export function BadgeCredentialPrint(props: { slug: string; credentialId: string; onBack: () => void }) {
  useSessionExpiry();
  const session = portalSession.value;
  if (!isAuthed.value || !session) return <ErrorAlert error="Sign in again to print this badge." />;
  return <SessionBadgePrint key={`${session.sessionId}:${session.identity.id}`} {...props} session={session} />;
}

function SessionBadgePrint({
  slug,
  credentialId,
  onBack,
  session,
}: {
  slug: string;
  credentialId: string;
  onBack: () => void;
  session: PortalSession;
}) {
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/badges/${encodeURIComponent(credentialId)}`;
  const request = useMemo(() => new AbortController(), [endpoint, session]);
  const record = useData(() => getJson(endpoint, badgeCredentialMetadataSchema, { signal: request.signal }), [request]);
  const [operationId] = useState(() => crypto.randomUUID());
  const [artifact, setArtifact] = useState<{
    owner: AbortController;
    print: z.output<typeof badgePrintResponseSchema>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = useRef<AbortController | null>(null);
  const print = artifact?.owner === request ? artifact.print : null;
  useEffect(() => {
    setArtifact(null);
    setError("");
    setBusy(false);
    return () => request.abort();
  }, [request]);
  useEffect(() => {
    if (!print) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      clearTimeout(timer);
      const remaining = Date.parse(print.expiresAt) - Date.now();
      if (remaining <= 0) {
        setArtifact(null);
        setError("This badge has expired and can no longer be printed.");
      } else timer = setTimeout(check, Math.min(remaining, 60_000));
    };
    check();
    window.addEventListener("pageshow", check);
    window.addEventListener("focus", check);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pageshow", check);
      window.removeEventListener("focus", check);
    };
  }, [print]);
  function current() {
    return (
      !request.signal.aborted &&
      isAuthed.value &&
      portalSession.value === session &&
      Math.min(Date.parse(session.expiresAt), Date.parse(session.idleExpiresAt)) > Date.now()
    );
  }
  async function verify(printResult: z.output<typeof badgePrintResponseSchema>) {
    if (!current()) throw new Error("Sign in again to print this badge.");
    const fresh = await getJson(endpoint, badgeCredentialMetadataSchema, { signal: request.signal });
    if (
      !current() ||
      fresh.id !== credentialId ||
      printResult.id !== credentialId ||
      fresh.eventId !== record.data?.eventId ||
      fresh.userId !== record.data?.userId ||
      fresh.status !== "active" ||
      !fresh.reprintAvailable ||
      fresh.expiresAt !== printResult.expiresAt ||
      fresh.displayName !== printResult.displayName ||
      Date.parse(printResult.expiresAt) <= Date.now()
    )
      throw new Error("This badge changed or is no longer available for printing. Open its record again.");
  }
  async function prepare() {
    if (running.current === request || !current()) return;
    running.current = request;
    setBusy(true);
    setError("");
    setArtifact(null);
    try {
      const body = badgePrintRequestSchema.parse({ operationId });
      const result = await requestJson(`${endpoint}/print`, badgePrintResponseSchema, {
        method: "POST",
        body: JSON.stringify(body),
        signal: request.signal,
      });
      await verify(result);
      setArtifact({ owner: request, print: result });
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : "Could not prepare this badge for printing.");
    } finally {
      if (running.current === request) running.current = null;
      if (current()) setBusy(false);
    }
  }
  async function beforeRelease() {
    if (!print) return false;
    try {
      await verify(print);
      return true;
    } catch (cause) {
      setArtifact(null);
      if (current()) setError(cause instanceof Error ? cause.message : "Could not check this badge.");
      return false;
    }
  }
  if (record.loading) return <Spinner label="Loading badge credential…" />;
  if (!record.data) return <ErrorAlert error={record.error ?? "Badge credential unavailable."} />;
  const available = record.data.status === "active" && record.data.reprintAvailable;
  return (
    <div class="pk-stack">
      <PageHeader
        title="Reprint badge"
        description={record.data.displayName ?? "Attendee name unavailable"}
        actions={<Button onClick={onBack}>Back to credential</Button>}
      />
      <p>Reprinting keeps this credential and its expiry unchanged. Keep downloaded print files private.</p>
      {!available ? (
        <p>
          Reprinting is unavailable for this credential. You can print a previously saved file or replace the
          credential.
        </p>
      ) : print ? (
        <BadgePrintPreview
          badges={[{ ...print, displayName: print.displayName ?? "Attendee name unavailable" }]}
          beforeRelease={beforeRelease}
        />
      ) : (
        <Button disabled={busy} onClick={() => void prepare()}>
          {busy ? "Preparing print preview…" : "Prepare print preview"}
        </Button>
      )}
      {error && <ErrorAlert error={error} />}
    </div>
  );
}
