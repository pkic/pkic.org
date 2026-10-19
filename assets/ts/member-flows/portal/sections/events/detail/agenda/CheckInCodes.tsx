/**
 * The event's check-in codes: one per day for checking in and out at the
 * venue, one per room, and one per session. Organizers download codes as SVG
 * for posters they design elsewhere (one code, or every listed code as a ZIP),
 * open any code full size to show it on a screen, and reissue them all when
 * printed codes must stop working. A studio output shows the same codes; for a
 * room it shows the code of the session running there.
 */
import { useRef, useState } from "preact/hooks";
import {
  attendancePointIssuanceResponseSchema,
  attendancePointsResponseSchema,
  type AttendancePoint,
} from "../../../../../../../shared/schemas/event-attendance-points";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
import { contractClock } from "../../../../../../../shared/event-clock";
import { ApiDataTable, type ApiTableActions } from "../../../../../../components/ApiDataTable";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
import {
  ATTENDANCE_POINT_KIND_FILTER,
  ATTENDANCE_POINT_KIND_LABELS,
  attendancePointDownloadHref,
  attendancePointPlace,
  attendancePointSvgHref,
  attendancePointTarget,
} from "../../../../../../components/attendance-points/attendance-point-copy";
import { postJson } from "../../../../../../shared/api-client";
import { Button } from "../../../../../../ui/Button";
import { DownloadAction } from "../../../../../../ui/DownloadAction";
import { RowActions } from "../../../../../../ui/RowActions";
import { toast } from "../../../../ui";
import { attendancePath } from "./attendance-navigation";

type PointsResponse = ReturnType<typeof attendancePointsResponseSchema.parse>;

export function checkInCodePath(basePath: string, point: AttendancePoint): string {
  return `${attendancePath(basePath, "check-in-codes", point.kind)}/${encodeURIComponent(attendancePointTarget(point))}`;
}

export function CheckInCodes({ slug, basePath }: { slug: string; basePath: string }) {
  const actions = useRef<ApiTableActions | null>(null);
  const [listing, setListing] = useState<PointsResponse | null>(null);
  const [reissuing, setReissuing] = useState(false);
  async function reissue() {
    const confirmed = await confirmAction({
      title: "Reissue all check-in codes?",
      body: "Use this when printed or shared codes must stop working.",
      consequences: [
        "Every printed code and every code shown on a screen stops working.",
        "You need to download and print the codes again, and refresh any screen showing a code.",
        "Check-ins already recorded stay recorded.",
      ],
      confirmLabel: "Reissue codes",
      tone: "danger",
    });
    if (!confirmed) return;
    setReissuing(true);
    try {
      await postJson(
        `/api/v1/events/${encodeURIComponent(slug)}/attendance/points/issuances`,
        {},
        attendancePointIssuanceResponseSchema,
      );
      toast("Check-in codes reissued. Download and print them again.", "success");
      await actions.current?.reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not reissue the codes.", "error");
    } finally {
      setReissuing(false);
    }
  }
  return (
    <ApiDataTable
      urlState="attendance-check-in-codes"
      endpoint={`/api/v1/events/${encodeURIComponent(slug)}/attendance/points`}
      responseSchema={attendancePointsResponseSchema}
      resolve={(data) => data.points}
      resolvePage={(data) => data.page}
      onData={setListing}
      actionsRef={actions}
      paginate
      caption="Check-in codes"
      rowKey={(point) => point.token}
      searchPlaceholder="Search codes…"
      inset={
        listing && (
          <p class="pk-muted">
            Codes issued {formatDateTimeInZone(listing.issuedAt, contractClock(listing))}. Codes printed before then no
            longer work.
          </p>
        )
      }
      toolbar={(_, query) => (
        <>
          <DownloadAction
            label="Download listed codes (ZIP of SVG files)"
            href={attendancePointDownloadHref(slug, "zip", query)}
            filename
          />
          {listing?.canReissue && (
            <Button loading={reissuing} onClick={() => void reissue()}>
              Reissue codes
            </Button>
          )}
        </>
      )}
      columns={[
        {
          header: "Code",
          cell: (point) => <a href={checkInCodePath(basePath, point)}>{point.label}</a>,
          sort: { asc: "label", desc: "-label" },
          hideable: false,
        },
        {
          header: "Type",
          cell: (point) => ATTENDANCE_POINT_KIND_LABELS[point.kind],
          filter: { param: "kind", options: ATTENDANCE_POINT_KIND_FILTER },
        },
        {
          header: "Day or room",
          cell: (point) =>
            point.session && listing
              ? [attendancePointPlace(point), formatDateTimeInZone(point.session.startAt, contractClock(listing))]
                  .filter(Boolean)
                  .join(" · ")
              : attendancePointPlace(point),
        },
        {
          header: "Actions",
          cell: (point) => (
            <RowActions
              subject={point.label}
              actions={[
                { id: "show", label: "Show code", href: checkInCodePath(basePath, point) },
                { id: "download", label: "Download SVG", href: attendancePointSvgHref(slug, point) },
              ]}
            />
          ),
          hideable: false,
          width: "fit",
        },
      ]}
    />
  );
}
