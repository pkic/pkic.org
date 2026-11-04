import {
  badgePrintDesignSchema,
  type BadgePrintDesign,
} from "../../../../../../../shared/schemas/event-badge-template";
import type { z } from "zod";
import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
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
import { IconScan } from "../../../../../../components/icons/app-navigation";
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
  const continuous = useRef(false);
  const printing = useBadgeLabelPrinting(slug, session, copies, design, sides, () => {
    if (continuous.current) void camera.start();
  });
  const camera = useScannerCamera((raw) => {
    if (camera.acceptsFrame(raw) && printing.scan(raw)) camera.stop();
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
        starting={camera.starting}
        busy={printing.busy}
        copies={copies}
        design={design}
        onDesign={setDesign}
        sides={sides}
        onSides={setSides}
        onCopies={(value) => setCopies(String(value))}
        start={() => {
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
        {printing.message && <p role="status">{printing.message}</p>}
        {(printing.error || camera.error) && <ErrorAlert error={printing.error || camera.error} />}
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
          onReady={printing.printReady}
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
}: {
  video: RefObject<HTMLVideoElement>;
  cameraActive: boolean;
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
  return (
    <div class="pk-label-desk pk-stack">
      <PageHeader
        title={design === "name_qr" ? "Print badge labels" : "Print badges"}
        description="Scan the QR code on the attendee’s ticket."
        actions={
          <Menu
            label="Print settings"
            align="end"
            items={[
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
        }
      />
      <div class="pk-label-desk__camera" aria-label={cameraActive ? "Ticket scanner" : "Camera off"}>
        <ScannerCamera video={video} cameraActive={cameraActive} fastMode={false} preview />
        {!cameraActive && (
          <>
            <IconScan />
            <p>{starting ? "Starting camera…" : "Camera off"}</p>
            <Button variant="primary" disabled={busy || starting} onClick={start}>
              Start camera
            </Button>
          </>
        )}
      </div>
      {cameraActive && (
        <div class="pk-cluster">
          <Button onClick={stop}>Stop camera</Button>
        </div>
      )}
      <Field label="Find an attendee">{search}</Field>
      {children}
    </div>
  );
}
