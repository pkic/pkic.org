import { usePrintScannerSound } from "../scanner/usePrintScannerSound";
import { useScannerTaskLaunch } from "../scanner/ScannerTaskNavigation";
import {
  badgePrintDesignSchema,
  type BadgePrintDesign,
} from "../../../../../../../shared/schemas/event-badge-template";
import type { z } from "zod";
import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { BADGE_LABEL_COPY_OPTIONS, BADGE_LABEL_DEFAULT_COPIES } from "../../../../../../../shared/badge-label-policy";
import { badgeAttendeesResponseSchema } from "../../../../../../../shared/schemas/route-contracts-event-badges";
import { BADGE_PRINT_SIDE_LABELS } from "../../../../../../../shared/badge-print-layout";
import {
  badgePrintSidesSchema,
  badgePrintLayoutSchema,
  type BadgePrintLayout,
} from "../../../../../../../shared/schemas/badge-print-layout";
import { formatNumber } from "../../../../../../../shared/format-number";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import { isAuthed, portalSession } from "../../../../state";
import type { PortalSession } from "../../../../types";
import { useSessionExpiry } from "../../../../use-session-expiry";
import { useScannerCamera } from "../scanner/useScannerCamera";
import { ScannerCamera } from "../scanner/ScannerCamera";
import { useBadgeLabelPrinting } from "./useBadgeLabelPrinting";
import { BadgeDocumentFrame } from "../../../../../../components/event-badges/BadgeDocumentFrame";
import { SearchPicker } from "../../../../../../components/SearchPicker";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { IconPrint, IconFullscreen } from "../../../../../../components/icons/app-navigation";
import { useScannerImmersiveLifecycle } from "../scanner/useScannerImmersiveLifecycle";
import { useScannerPresentation } from "../scanner/useScannerPresentation";
import { FastScannerView } from "../scanner/FastScannerView";
import { IconScannerHelp } from "../../../../../../components/icons/scanner-controls";
import { IconVirtual } from "../../../../../../components/icons";
import { BadgePdfActions } from "./BadgePdfActions";
import type { ScannerStatus } from "../scanner/ScannerStatus";
import { Button } from "../../../../../../ui/Button";
import { Field, type FieldControlProps } from "../../../../../../ui/Field";
import { Menu } from "../../../../../../ui/Menu";
import { PageHeader } from "../../../../../../ui/PageHeader";
import { PersonCell } from "../../../../../../ui/PersonCell";
import { personDisplayName } from "../../../../../../../shared/person-display";
import "../scanner/EventScanner.css";
import "./BadgeLabelDesk.css";

const copyChoices = BADGE_LABEL_COPY_OPTIONS.map(String);

export function BadgeLabelDesk({ slug }: { slug: string }) {
  useSessionExpiry();
  const session = portalSession.value;
  if (!isAuthed.value || !session) return <ErrorAlert error="Sign in again to print labels." />;
  return <SessionLabelDesk key={`${slug}:${session.sessionId}:${session.identity.id}`} slug={slug} session={session} />;
}

function SessionLabelDesk({ slug, session }: { slug: string; session: PortalSession }) {
  const [copiesQuery, setCopies] = useHashQueryParam("labelCopies", String(BADGE_LABEL_DEFAULT_COPIES), copyChoices);
  const [design, setDesign] = useHashQueryParam("printDesign", "name_qr", badgePrintDesignSchema.options);
  const [sides, setSides] = useHashQueryParam("badgeSides", "front_back", badgePrintSidesSchema.options);
  const copies = badgePrintLayoutSchema.shape.copies.parse(Number(copiesQuery));
  const [format, setFormat] = useHashQueryParam("printFormat", "html", ["html", "pdf"]);
  const [pdfUrl, setPdfUrl] = useState("");
  const continuous = useRef(false);
  const paused = useRef(false);
  const printing = useBadgeLabelPrinting(
    slug,
    session,
    copies,
    design,
    sides,
    () => {
      if (continuous.current) void camera.start();
    },
    format,
  );
  useEffect(() => {
    if (!printing.pdf) {
      setPdfUrl("");
      return;
    }
    const url = URL.createObjectURL(printing.pdf);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [printing.pdf]);
  const sound = usePrintScannerSound(printing.job?.key, printing.busy, printing.error);
  const camera = useScannerCamera((raw) => {
    if (!paused.current && camera.acceptsFrame(raw) && printing.scan(raw)) camera.stop();
  });
  useScannerTaskLaunch("print", () => {
    sound.unlock();
    continuous.current = true;
    void camera.start();
  });
  const stopCamera = useRef(camera.stop);
  stopCamera.current = camera.stop;
  useEffect(
    () => () => {
      continuous.current = false;
      stopCamera.current();
    },
    [],
  );
  return (
    <>
      <BadgeLabelDeskView
        video={camera.video}
        cameraActive={camera.active}
        cameraError={camera.error}
        starting={camera.starting}
        busy={printing.busy}
        status={
          printing.error
            ? {
                key: `${printing.job?.key ?? "print"}:error:${printing.error}`,
                tone: "denied",
                title: "Could not print",
                detail: printing.error,
              }
            : printing.job && !printing.busy
              ? {
                  key: printing.job.key,
                  tone: "eligible",
                  title: printing.pdf ? "PDF ready" : "Print requested",
                  detail: printing.job.label.displayName ?? "Attendee",
                  transient: !printing.pdf,
                }
              : undefined
        }
        sound={sound}
        onOperatorPause={(value) => {
          paused.current = value;
        }}
        format={format}
        onFormat={setFormat}
        copies={copies}
        design={design}
        onDesign={setDesign}
        sides={sides}
        onSides={setSides}
        onCopies={(value) => setCopies(String(value))}
        start={() => {
          sound.unlock();
          continuous.current = true;
          void camera.start();
        }}
        stop={() => {
          continuous.current = false;
          camera.stop();
        }}
        search={(control) => (
          <SearchPicker<
            z.infer<typeof badgeAttendeesResponseSchema>,
            z.infer<typeof badgeAttendeesResponseSchema>["users"][number]
          >
            inputProps={control}
            picked={null}
            onPick={(user) => {
              camera.stop();
              printing.selectAttendee(user.id);
            }}
            onClear={() => {}}
            endpoint={`/api/v1/events/${encodeURIComponent(slug)}/badges/attendees`}
            responseSchema={badgeAttendeesResponseSchema}
            rows={(data) => data.users}
            rowKey={(user) => user.id}
            rowText={(user) => personDisplayName({ firstName: user.first_name, lastName: user.last_name }, user.email)}
            renderRow={(user) => (
              <PersonCell
                name={personDisplayName({ firstName: user.first_name, lastName: user.last_name }, user.email)}
                organization={user.organization_name}
                detail={
                  <>
                    {user.email}
                    {user.organization_name ? ` · ${user.organization_name}` : ""}
                  </>
                }
                size="sm"
              />
            )}
            noun={["attendee", "attendees"]}
            label="Find an attendee"
            resultsLabel="Matching attendees"
            sort="email"
            placeholder="Name, email, or organization"
            disabled={printing.busy}
            emptyMessage="No registered attendees found."
            errorMessage="Could not search attendees."
          />
        )}
      >
        {printing.pdf && pdfUrl && <BadgePdfActions pdf={printing.pdf} url={pdfUrl} />}

        {printing.job && (
          <div class="pk-cluster">
            <Button disabled={printing.busy} onClick={printing.reprint}>
              {design === "name_qr" ? "Print labels again" : "Print badges again"}
            </Button>
          </div>
        )}
      </BadgeLabelDeskView>
      {printing.job && (
        <BadgeDocumentFrame
          key={printing.job.key}
          frameRef={printing.frame}
          className="pk-label-desk__print-document"
          title={printing.job.design === "name_qr" ? "Attendee label print document" : "Attendee badge print document"}
          html={printing.html}
          onReady={() => void printing.printReady()}
          onError={printing.documentError}
        />
      )}
    </>
  );
}

/** One camera surface and one bounded attendee search, shared with the gallery specimen. */
export function BadgeLabelDeskView({
  video,
  cameraActive,
  cameraError,
  starting,
  busy,
  copies,
  onCopies,
  design,
  onDesign,
  sides,
  onSides,
  start,
  stop,
  search,
  children,
  sound,
  format = "html",
  onFormat,
  status,
  onOperatorPause,
}: {
  onOperatorPause?: (value: boolean) => void;
  status?: ScannerStatus;
  sound?: Pick<ReturnType<typeof usePrintScannerSound>, "label" | "toggleSound" | "test">;
  format?: "html" | "pdf";
  onFormat?: (value: "html" | "pdf") => void;
  video: RefObject<HTMLVideoElement>;
  cameraActive: boolean;
  cameraError?: string;
  starting: boolean;
  busy: boolean;
  copies: number;
  design: BadgePrintDesign;
  onDesign: (value: BadgePrintDesign) => void;
  sides: BadgePrintLayout["sides"];
  onSides: (value: BadgePrintLayout["sides"]) => void;
  onCopies: (value: number) => void;
  start: () => void;
  stop: () => void;
  search: (control: FieldControlProps) => ComponentChildren;
  children?: ComponentChildren;
}) {
  const [preview, setPreview] = useState(false);
  const [helpOnStart, setHelpOnStart] = useState(false);
  const cameraShell = useRef<HTMLDivElement>(null);
  const { presentation, setPresentation, toggle } = useScannerPresentation(cameraShell, "responsive");
  const fullscreen = presentation === "fullscreen";
  const screenAwake = useScannerImmersiveLifecycle(fullscreen, cameraShell, () => {
    stop();
    setPresentation("embedded");
  });
  const settings = (
    <Menu
      label="Print settings"
      align="end"
      items={[
        ...(onFormat
          ? [
              {
                id: "pdf",
                label: "Use PDF",
                multiple: true,
                checked: format === "pdf",
                disabled: busy,
                onSelect: () => onFormat(format === "pdf" ? "html" : "pdf"),
              },
            ]
          : []),
        {
          id: "labels",
          label: "Labels",
          checked: design === "name_qr",
          disabled: busy,
          onSelect: () => onDesign("name_qr"),
        },
        {
          id: "badges",
          label: "Full badges",
          checked: design === "event_badge",
          disabled: busy,
          onSelect: () => onDesign("event_badge"),
        },
        ...(design === "name_qr"
          ? BADGE_LABEL_COPY_OPTIONS.map((count) => ({
              separatorBefore: count === 1,
              id: String(count),
              label: `${formatNumber(count)} ${count === 1 ? "label" : "labels"}`,
              checked: copies === count,
              disabled: busy,
              onSelect: () => onCopies(count),
            }))
          : (["front_back", "front", "back"] as const).map((side, index) => ({
              separatorBefore: index === 0,
              id: side,
              label: BADGE_PRINT_SIDE_LABELS[side],
              checked: sides === side,
              disabled: busy,
              onSelect: () => onSides(side),
            }))),
      ]}
    />
  );
  return (
    <div class="pk-label-desk pk-stack">
      {!fullscreen && (
        <PageHeader
          title={design === "name_qr" ? "Print badge labels" : "Print badges"}
          description="Scan the QR code on the attendee’s ticket."
          actions={settings}
        />
      )}
      <div
        ref={cameraShell}
        class={`pk-label-desk__camera pk-scanner-viewport${fullscreen ? " pk-label-desk__camera--fullscreen" : ""}`}
        data-fullscreen={fullscreen || undefined}
        aria-label={cameraActive ? "Ticket scanner" : "Camera off"}
      >
        {!fullscreen && (
          <div class="pk-label-desk__camera-toolbar">
            <span class="pk-cluster">
              <IconPrint /> Print
            </span>
            <Button
              icon
              variant="secondary"
              data-tour-trigger
              aria-label="Scanner help"
              title="Scanner help"
              onClick={() => {
                onOperatorPause?.(true);
                setHelpOnStart(true);
                setPresentation("fullscreen");
              }}
            >
              <IconScannerHelp />
            </Button>
            <Button
              variant="ghost"
              aria-label={fullscreen ? "Exit full screen" : "Enter full screen"}
              title={fullscreen ? "Exit full screen" : "Enter full screen"}
              onClick={toggle}
            >
              <IconFullscreen />
            </Button>
          </div>
        )}
        <ScannerCamera
          video={video}
          cameraActive={cameraActive}
          fastMode={fullscreen}
          preview={!fullscreen || preview}
        />
        {fullscreen && (
          <FastScannerView
            purpose="print"
            helpOnStart={helpOnStart}
            taskSwitchDisabled={busy || starting}
            screenAwake={screenAwake}
            soundLabel={sound?.label}
            onSound={sound?.toggleSound}
            onTourSound={sound?.test}
            onOperatorPause={onOperatorPause}
            context={design === "name_qr" ? "Labels" : "Full badges"}
            result={null}
            pending={0}
            status={
              busy
                ? { key: "preparing", tone: "unverified", title: "Preparing print document…", record: false }
                : status
            }
            statusActions={children}
            operatorControls={settings}
            message={busy || status ? "" : "Scan an attendee’s ticket."}
            cameraActive={cameraActive}
            cameraError={cameraError}
            cameraStarting={starting}
            onCameraRetry={start}
            preview={preview}
            onPreview={() => setPreview((value) => !value)}
            onExit={() => {
              stop();
              setHelpOnStart(false);
              setPresentation("embedded");
            }}
            onManual={() => {
              setHelpOnStart(false);
              setPresentation("embedded");
            }}
            canRecordAttendance={false}
          />
        )}
        {!fullscreen && !cameraActive && (
          <>
            <p>{starting ? "Starting camera…" : "Camera off"}</p>
            <Button variant="primary" disabled={busy || starting} onClick={start}>
              <IconVirtual /> Start camera
            </Button>
          </>
        )}
      </div>
      {!fullscreen && cameraActive && (
        <div class="pk-cluster">
          <Button onClick={stop}>Stop camera</Button>
        </div>
      )}
      {!fullscreen && <Field label="Find an attendee">{search}</Field>}
      {!fullscreen && (
        <div role="status" aria-live="polite">
          {busy ? "Preparing print document…" : status?.title}
          {status?.detail && <p>{status.detail}</p>}
          {cameraError && <ErrorAlert error={cameraError} />}
          {children}
        </div>
      )}
    </div>
  );
}
