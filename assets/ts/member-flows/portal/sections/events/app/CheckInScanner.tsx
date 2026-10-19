/**
 * The attendee's camera for check-in codes, on the same QR decoder the badge
 * scanner uses. A decoded check-in link opens its confirmation screen in the
 * app; anything else is named as not a check-in code and never followed.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { scannedAttendancePoint } from "../../../../../components/attendance-points/attendance-point-url";
import { Alert } from "../../../../../ui/Alert";
import { Button } from "../../../../../ui/Button";
import { openBadgeCamera } from "../detail/scanner/camera-driver";
import "./EventCheckIn.css";

export function CheckInScanner({ onPoint }: { onPoint: (point: { eventSlug: string; token: string }) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [active, setActive] = useState(false);
  const [problem, setProblem] = useState<"camera" | "not_a_code" | null>(null);
  const handled = useRef(false);
  useEffect(() => {
    if (!video.current) return;
    let stop: (() => void) | null = null;
    handled.current = false;
    openBadgeCamera(
      video.current,
      (raw) => {
        if (handled.current) return;
        const point = scannedAttendancePoint(raw);
        if (!point) {
          setProblem("not_a_code");
          return;
        }
        handled.current = true;
        stop?.();
        onPoint(point);
      },
      setActive,
      (registered) => {
        stop = registered;
      },
    ).catch(() => setProblem("camera"));
    return () => stop?.();
  }, [attempt]);
  return (
    <div class="pk-stack">
      <p>Point your camera at the check-in code at the entrance or by the room door.</p>
      <video
        ref={video}
        class={`pk-check-in-camera${active ? "" : " pk-check-in-camera--idle"}`}
        muted
        playsInline
        aria-label="Camera view for scanning a check-in code"
      />
      {problem === "camera" ? (
        <Alert tone="warn" title="The camera didn't start">
          <p>Allow camera access for this site, then try again. You can also scan the code with your phone's camera.</p>
          <div class="pk-cluster">
            <Button
              onClick={() => {
                setProblem(null);
                setAttempt((value) => value + 1);
              }}
            >
              Try again
            </Button>
          </div>
        </Alert>
      ) : problem === "not_a_code" ? (
        <p role="status">That's not a check-in code. Scan the code on a check-in poster or screen.</p>
      ) : null}
    </div>
  );
}
