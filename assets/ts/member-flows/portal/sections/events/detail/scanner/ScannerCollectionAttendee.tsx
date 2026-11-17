import { Button } from "../../../../../../ui/Button";

/** The held attendee name and optional print action share the current scan's lifetime. */
export function ScannerCollectionAttendee({
  name,
  loading,
  saving,
  onPrint,
  onAdvance,
}: {
  name: string | null;
  loading: boolean;
  saving?: boolean;
  onPrint?: () => void;
  onAdvance?: () => void;
}) {
  return (
    <>
      <p class={onAdvance ? undefined : "pk-fast-scanner__attendee"} aria-label="Attendee name">
        {name ?? (loading ? "Loading name…" : "Name unavailable. Ask the attendee or use staff search.")}
      </p>
      {(onPrint || onAdvance) && (
        <div class="pk-cluster">
          {onPrint && (
            <Button variant="secondary" onClick={onPrint} disabled={saving}>
              Print this badge
            </Button>
          )}
          {onAdvance && (
            <Button onClick={onAdvance} disabled={saving}>
              Next attendee
            </Button>
          )}
        </div>
      )}
    </>
  );
}
