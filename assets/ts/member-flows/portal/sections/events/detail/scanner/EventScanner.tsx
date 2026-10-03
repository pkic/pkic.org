import scannerWorkerUrl from "./scanner-service-worker?worker&url";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  scanActionSchema,
  scannerTargetsResponseSchema,
  type ScannerTarget,
  type ScannerTargetsResponse,
  eventScanRequestSchema,
  eventScanResponseSchema,
  type EventScanResponse,
  type EventScanRequest,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { ServerSearchSelect } from "../../../../../../components/ServerSearchSelect";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Field } from "../../../../../../ui/Field";
import { TextInput, Select } from "../../../../../../ui/TextControl";
import { Button, ButtonLink } from "../../../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { openBadgeCamera } from "./camera-driver";
import { ScanFrameGate, receiptMatchesOperation, unknownScanResponse } from "./scan-stream";
import { queueScan, drainScanOutbox, pendingScanCount } from "./scan-outbox";
import "./EventScanner.css";
import { FastScannerView } from "./FastScannerView";
import { enterScannerFullscreen, scannerImmersiveLifecycle } from "./immersive-scanner";
import { useEligibilityManifest } from "./useEligibilityManifest";
import { ScannerFeedback } from "./ScannerFeedback";
import { useScanCooldown } from "./useScanCooldown";
import { ScannerPacing } from "./ScannerPacing";
import { ScannerRecovery } from "./ScannerRecovery";

export function EventScanner({
  slug,
  operatorUserId,
  occurrenceId = null,
  sponsorId,
  canAdmitExceptions = false,
  canExportLeads = false,
}: {
  slug: string;
  operatorUserId: string;
  occurrenceId?: string | null;
  sponsorId?: string;
  canAdmitExceptions?: boolean;
  canExportLeads?: boolean;
}) {
  const [targetId, setTarget] = useState(occurrenceId);
  const [targetLabel, setTargetLabel] = useState("");
  const [badgeId, setBadge] = useState("");
  const [action, setAction] = useState<(typeof scanActionSchema.options)[number]>(sponsorId ? "lead" : "attendance");
  const [exceptionReason, setExceptionReason] = useState<
    "organizer_approval" | "registration_correction" | "accessibility_support"
  >("organizer_approval");
  const [consentConfirmed, setConsent] = useState(false);
  const [pending, setPending] = useState(0);
  const lastOperation = useRef<string | null>(null);
  const lastCommittedOperation = useRef<string | null>(null);
  const lastBadge = useRef("");
  const [deviceId] = useState(() => crypto.randomUUID());
  const [operationId, setOperation] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<EventScanResponse | null>(null);
  const [message, setMessage] = useState("Ready to scan");
  const [uploadStatus, setUploadStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [screenAwake, setScreenAwake] = useState(false);
  const [feedbackPause, setFeedbackPause] = useState(600);
  const cooldown = useScanCooldown(feedbackPause);
  const [fastMode, setFastMode] = useState(false);
  const [preview, setPreview] = useState(false);
  const scannerShell = useRef<HTMLDivElement>(null);
  const stopCamera = useRef<() => void>(() => {});
  const { eligibilityManifest, manifestReady, manifestPreparing, manifestError } = useEligibilityManifest(
    slug,
    operatorUserId,
    targetId,
    action,
    () => {
      authorityPaused.current = true;
      stopCamera.current();
      lastOperation.current = null;
      setResult(null);
      setMessage("Sign in again to upload pending scans.");
    },
  );
  useEffect(() => {
    if (!fastMode || !scannerShell.current) return;
    const release = scannerImmersiveLifecycle(scannerShell.current, () => setFastMode(false), setScreenAwake);
    return () => {
      stopCamera.current();
      cooldown.reset();
      release();
    };
  }, [fastMode]);
  useEffect(() => {
    if (!fastMode) return;
    let credential = "";
    let previous = 0;
    const hardware = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (Date.now() - previous > 5000) credential = "";
      previous = Date.now();
      if (event.key === "Enter" && credential) {
        event.preventDefault();
        void scanCredential(credential);
        credential = "";
      } else if (event.key.length === 1 && event.key !== " ") {
        event.preventDefault();
        credential = (credential + event.key).slice(-128);
      }
    };
    document.addEventListener("keydown", hardware);
    return () => document.removeEventListener("keydown", hardware);
  }, [fastMode]);
  const form = useContractForm(eventScanRequestSchema, {
    operationId,
    operatorUserId,
    deviceId,
    badgeId,
    occurrenceId: targetId,
    action,
    ...(action === "exception" ? { exceptionReason } : {}),
    ...(action === "lead" ? { sponsorId, consentConfirmed } : {}),
    observedAt: new Date().toISOString(),
  });
  const retryTimer = useRef<number | null>(null);
  const activeSyncs = useRef(0);
  const syncAgain = useRef(false);
  const authorityPaused = useRef(false);
  const scannerContext = useRef({ targetId, action, operatorUserId, deviceId });
  scannerContext.current = { targetId, action, operatorUserId, deviceId };
  async function sync() {
    if (activeSyncs.current >= 4) {
      syncAgain.current = true;
      return;
    }
    activeSyncs.current++;
    try {
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
      const drained = await drainScanOutbox(async (record) => {
        const response = await fetch(`/api/v1/events/${encodeURIComponent(record.eventId)}/scans`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(record.scan),
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) {
          const receipt = eventScanResponseSchema.parse(await response.clone().json());
          if (!authorityPaused.current && receiptMatchesOperation(receipt.operationId, lastOperation.current))
            setResult(receipt);
        }
        return response;
      }, operatorUserId);
      if (drained.state === "authentication_required") {
        authorityPaused.current = true;
        setResult(null);
        stopCamera.current();
        syncAgain.current = false;
      }
      const remaining = await pendingScanCount(operatorUserId);
      setPending(remaining);
      if (remaining > 0 && drained.state !== "authentication_required") {
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.getRegistration("/portal/");
          if (registration && "sync" in registration)
            void (registration as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } }).sync
              .register("pkic-scanner-upload")
              .catch(() => {});
        }
      }

      if (drained.state === "retry" && navigator.onLine)
        retryTimer.current = window.setTimeout(() => {
          void sync();
        }, drained.retryAfterMs ?? 1000);
      if (authorityPaused.current) setMessage("Sign in again to upload pending scans.");
      setUploadStatus(
        authorityPaused.current
          ? "Sign in again to upload pending scans."
          : remaining === 0
            ? "All pending scans uploaded."
            : drained.state === "retry"
              ? "Uploads will resume when connected."
              : "Uploading scans in the background…",
      );
    } finally {
      activeSyncs.current--;
      if (syncAgain.current) {
        syncAgain.current = false;
        void sync();
      }
    }
  }
  useEffect(() => {
    const reconnect = () => {
      void sync();
    };
    window.addEventListener("online", reconnect);
    const acknowledged = (event: MessageEvent<unknown>) => {
      const receipt = eventScanResponseSchema.safeParse(event.data);
      if (!receipt.success) return;
      if (!authorityPaused.current && receiptMatchesOperation(receipt.data.operationId, lastOperation.current))
        setResult(receipt.data);
      void pendingScanCount(operatorUserId).then(setPending);
    };
    navigator.serviceWorker?.addEventListener("message", acknowledged);
    const resume = () => {
      if (document.visibilityState === "visible") reconnect();
    };
    document.addEventListener("visibilitychange", resume);
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.register(scannerWorkerUrl, { scope: "/portal/", type: "module" }).catch(() => {});
    reconnect();
    return () => {
      window.removeEventListener("online", reconnect);
      navigator.serviceWorker?.removeEventListener("message", acknowledged);
      document.removeEventListener("visibilitychange", resume);
      stopCamera.current();
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    };
  }, [slug]);
  async function showLocalEligibility(scan: EventScanRequest) {
    const manifest = eligibilityManifest.current;
    if (
      (scan.action !== "attendance" && scan.action !== "check") ||
      !manifest ||
      manifest.operatorUserId !== scan.operatorUserId ||
      manifest.occurrenceId !== scan.occurrenceId
    )
      return;
    const local = await manifest.lookup(scan.badgeId);
    if (
      authorityPaused.current ||
      lastCommittedOperation.current === scan.operationId ||
      !receiptMatchesOperation(scan.operationId, lastOperation.current)
    )
      return;
    setResult({
      operationId: scan.operationId,
      outcome: local.outcome,
      reason: local.reason,
      recorded: false,
      attendanceRecorded: false,
    });
    setMessage(local.message);
  }
  async function submit(event: Event) {
    event.preventDefault();
    if (authorityPaused.current) {
      setMessage("Sign in again to upload pending scans.");
      return;
    }
    const checked = form.submit();
    if (!checked.data) {
      lastOperation.current = null;
      setMessage("Invalid QR code. Scan a PKI Consortium badge.");
      setResult(unknownScanResponse(operationId));
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      lastBadge.current = checked.data.badgeId;
      lastOperation.current = checked.data.operationId;
      await queueScan({ eventId: slug, scan: checked.data });
      setUploadStatus("Uploading scans in the background…");
      setPending(await pendingScanCount(operatorUserId));
      setMessage("Scan saved. Checking eligibility…");
      await showLocalEligibility(checked.data);
      void sync();
      setBadge("");
      if (action === "lead") setConsent(false);
      setOperation(crypto.randomUUID());
    } catch {
      setMessage("Unable to save this scan. Keep the attendee here and retry.");
    } finally {
      setBusy(false);
    }
  }
  const cameraFrames = useRef(new ScanFrameGate());
  async function scanCredential(raw: string, fromCamera = false) {
    if (authorityPaused.current) return;
    const current = scannerContext.current;
    if (current.action === "lead" || current.action === "exception") {
      setBadge(raw);
      lastBadge.current = raw;
      stopCamera.current();
      setFastMode(false);
      if (current.action === "lead") setConsent(false);
      setMessage("Badge detected. Review and confirm before recording.");
      return;
    }
    if (fastMode && !cooldown.ready()) return;
    const parsed = eventScanRequestSchema.safeParse({
      operatorUserId: current.operatorUserId,
      operationId: crypto.randomUUID(),
      deviceId: current.deviceId,
      badgeId: raw,
      occurrenceId: current.targetId,
      action: current.action,
      observedAt: new Date().toISOString(),
    });
    if (!parsed.success) {
      if (fastMode && !cooldown.accept()) return;
      lastOperation.current = null;
      setResult(unknownScanResponse(crypto.randomUUID()));
      setMessage("Invalid QR code. Scan a PKI Consortium badge.");
      if (fastMode) cooldown.feedback();
      return;
    }
    if (fromCamera && !cameraFrames.current.accept(parsed.data.badgeId, Date.now())) return;
    if (fastMode && !cooldown.accept()) return;
    const operation = parsed.data.operationId;
    lastOperation.current = operation;
    lastBadge.current = parsed.data.badgeId;
    setResult(null);
    setMessage("Checking eligibility…");
    try {
      await queueScan({ eventId: slug, scan: parsed.data });
      setUploadStatus("Uploading scans in the background…");
      setPending(await pendingScanCount(operatorUserId));
      await showLocalEligibility(parsed.data);
      if (fastMode) cooldown.feedback();
      void sync();
    } catch {
      if (fastMode) cooldown.reset();
      if (receiptMatchesOperation(operation, lastOperation.current)) setMessage("Unable to save scan. Retry.");
    }
  }
  async function camera() {
    if (authorityPaused.current) {
      setMessage("Sign in again to upload pending scans.");
      return;
    }
    try {
      if (!video.current) return;
      stopCamera.current();
      cameraFrames.current.clear();
      await openBadgeCamera(
        video.current,
        (raw) => {
          void scanCredential(raw, true);
        },
        setCameraActive,
        (stop) => {
          stopCamera.current = stop;
        },
      );
    } catch {
      stopCamera.current();
      setCameraActive(false);
      setMessage("Camera access is unavailable. Use a connected scanner or manual entry.");
    }
  }
  return (
    <div ref={scannerShell}>
      <div hidden={fastMode}>
        <Panel>
          <PanelHeader title="Badge scanner" />
          {sponsorId && canExportLeads && (
            <PanelBody>
              <ButtonLink
                href={`/api/v1/events/${encodeURIComponent(slug)}/sponsors/${encodeURIComponent(sponsorId)}/leads.csv`}
                download={`leads-${slug}.csv`}
              >
                Download consenting leads
              </ButtonLink>
              <p>Exports current contact details for this sponsor’s captured leads who still consent to sharing.</p>
            </PanelBody>
          )}
          <PanelBody>
            <p>No attendee names or contact details are stored on this phone.</p>
            <ScannerRecovery slug={slug} operatorUserId={operatorUserId} />
            <ScannerFeedback result={result} action={action} message={message} pending={pending} />
            <form noValidate {...form.handlers} onSubmit={submit}>
              <ScannerPacing value={feedbackPause} onChange={setFeedbackPause} />
              <Field
                label="Check-in location"
                {...form.of("occurrenceId")}
                help="Leave empty for event admission. Select a session for session check-in."
              >
                {(control) => (
                  <ServerSearchSelect<ScannerTarget, ScannerTargetsResponse>
                    {...control}
                    searchLabel="Session"
                    value={targetId}
                    selectedLabel={targetLabel}
                    allowEmpty
                    onChange={(item) => {
                      stopCamera.current();
                      lastOperation.current = null;
                      setTarget(item?.id ?? null);
                      setTargetLabel(item?.title ?? "");
                      setResult(null);
                    }}
                    catalog={{
                      endpoint: `/api/v1/events/${encodeURIComponent(slug)}/scans/targets`,
                      responseSchema: scannerTargetsResponseSchema,
                      resolveItems: (value) => value.sessions,
                      resolvePage: (value) => value.page,
                      itemKey: (item) => item.id,
                      itemLabel: (item) => item.title,
                      sort: "title",
                    }}
                  />
                )}
              </Field>
              <Field label="Scan mode" {...form.of("action")}>
                {(control) => (
                  <Select
                    {...control}
                    name="action"
                    value={action}
                    onChange={(event) => {
                      stopCamera.current();
                      lastOperation.current = null;
                      setAction(event.currentTarget.value as typeof action);
                      setResult(null);
                    }}
                  >
                    {scanActionSchema.options
                      .filter((value) =>
                        sponsorId
                          ? value === "lead"
                          : value !== "lead" && (value !== "exception" || canAdmitExceptions),
                      )
                      .map((value) => (
                        <option value={value}>
                          {value === "attendance"
                            ? "Record attendance"
                            : value === "exception"
                              ? "Admit exception"
                              : value === "lead"
                                ? "Capture sponsor lead"
                                : "Check admission only"}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
              {action === "exception" && (
                <Field label="Exception reason" {...form.of("exceptionReason")}>
                  {(control) => (
                    <Select
                      {...control}
                      name="exceptionReason"
                      value={exceptionReason}
                      onChange={(event) => setExceptionReason(event.currentTarget.value as typeof exceptionReason)}
                    >
                      {eventScanRequestSchema.shape.exceptionReason.unwrap().options.map((value) => (
                        <option value={value}>{value.replaceAll("_", " ")}</option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              {action === "lead" && (
                <Field label="Attendee consent" {...form.of("consentConfirmed")} group>
                  {(control) => (
                    <Checkbox
                      {...control}
                      name="consentConfirmed"
                      checked={consentConfirmed}
                      onChange={(event) => setConsent(event.currentTarget.checked)}
                      label="The attendee agrees to share their contact details with this sponsor."
                    />
                  )}
                </Field>
              )}
              {result?.outcome === "warning" && canAdmitExceptions && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setAction("exception");
                    setBadge(lastBadge.current);
                  }}
                >
                  Review admission exception
                </Button>
              )}
              <Field label="Badge code" {...form.of("badgeId")}>
                {(control) => (
                  <TextInput
                    {...control}
                    name="badgeId"
                    value={badgeId}
                    onInput={(event) => setBadge(event.currentTarget.value)}
                    autoComplete="off"
                  />
                )}
              </Field>
              <Button type="submit" loading={busy}>
                {action === "lead" ? "Capture lead" : action === "exception" ? "Admit exception" : "Check badge"}
              </Button>{" "}
              {(action === "attendance" || action === "check") && (
                <>
                  <Button
                    type="button"
                    disabled={!manifestReady || manifestPreparing}
                    onClick={() => {
                      if (scannerShell.current) enterScannerFullscreen(scannerShell.current);
                      setResult(null);
                      lastOperation.current = null;
                      setMessage("Ready to scan");
                      setPreview(false);
                      setFastMode(true);
                      void camera();
                    }}
                  >
                    Start scanning
                  </Button>
                  <p>
                    {manifestPreparing
                      ? "Preparing fast eligibility checks…"
                      : manifestReady
                        ? "Eligibility data ready. Checks run locally; attendance uploads in the background."
                        : manifestError || "Prepare eligibility data before scanning."}
                  </p>
                  {!manifestReady && !manifestPreparing && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        if (scannerShell.current) enterScannerFullscreen(scannerShell.current);
                        lastOperation.current = null;
                        setResult(null);
                        setMessage("Unverified scanning. Admission requires verification.");
                        setPreview(false);
                        setFastMode(true);
                        void camera();
                      }}
                    >
                      Start with unverified feedback
                    </Button>
                  )}
                </>
              )}{" "}
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (cameraActive) stopCamera.current();
                  else void camera();
                }}
              >
                {cameraActive ? "Stop camera" : "Use camera"}
              </Button>{" "}
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  void sync();
                }}
              >
                Sync now
              </Button>
            </form>
          </PanelBody>
        </Panel>
      </div>
      {fastMode && (
        <FastScannerView
          context={targetLabel || (targetId ? "Session check-in" : `Event · ${slug}`)}
          result={result}
          pending={pending}
          message={message}
          uploadStatus={uploadStatus}
          cooldown={cooldown}
          screenAwake={screenAwake}
          cameraActive={cameraActive}
          preview={preview}
          onPreview={() => setPreview(!preview)}
          onExit={() => {
            cooldown.reset();
            lastOperation.current = null;
            setResult(null);
            setFastMode(false);
          }}
        />
      )}
      <video
        ref={video}
        hidden={!cameraActive || (fastMode && !preview)}
        muted
        playsInline
        className={`pk-event-scanner__camera${fastMode ? " pk-event-scanner__camera--fast" : ""}`}
        aria-label="Badge camera preview"
      />
    </div>
  );
}
