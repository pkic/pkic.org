/**
 * One check-in code full size, to show on a screen at the door or in a room,
 * with its SVG download for a poster designed elsewhere.
 */
import { attendancePointsResponseSchema } from "../../../../../../../shared/schemas/event-attendance-points";
import { CheckInQrGraphic } from "../../../../../../components/attendance-points/CheckInQrGraphic";
import {
  ATTENDANCE_POINT_KIND_LABELS,
  attendancePointFilter,
  attendancePointPlace,
  attendancePointSvgHref,
} from "../../../../../../components/attendance-points/attendance-point-copy";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../components/Spinner";
import { useData } from "../../../../../../hooks/useData";
import { getJson } from "../../../../../../shared/api-client";
import { DownloadAction } from "../../../../../../ui/DownloadAction";
import { SectionHeading } from "../../../../../../ui/SectionHeading";
import "./CheckInCodes.css";

export function CheckInCodeView({ slug, kind, target }: { slug: string; kind: string; target: string }) {
  const filter = attendancePointFilter(kind, target);
  const loaded = useData(async () => {
    if (!filter) return null;
    const query = new URLSearchParams({ ...filter, limit: "1" });
    const listing = await getJson(
      `/api/v1/events/${encodeURIComponent(slug)}/attendance/points?${query}`,
      attendancePointsResponseSchema,
    );
    return listing.points[0] ?? null;
  }, [slug, kind, target]);
  if (loaded.loading) return <Spinner label="Loading the code…" />;
  if (loaded.error) return <ErrorAlert error={loaded.error} />;
  const point = loaded.data;
  if (!point) return <ErrorAlert error="This check-in code does not exist. It may belong to a removed day or room." />;
  return (
    <section class="pk-stack" aria-labelledby="check-in-code-title">
      <div class="pk-stack pk-stack--tight">
        <SectionHeading level={3} id="check-in-code-title">
          {point.label}
        </SectionHeading>
        <p class="pk-muted">
          {[ATTENDANCE_POINT_KIND_LABELS[point.kind], attendancePointPlace(point)].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div class="pk-check-in-code">
        <CheckInQrGraphic point={point} />
      </div>
      <div class="pk-cluster">
        <DownloadAction label={`Download ${point.label} (SVG)`} href={attendancePointSvgHref(slug, point)} filename />
      </div>
    </section>
  );
}
