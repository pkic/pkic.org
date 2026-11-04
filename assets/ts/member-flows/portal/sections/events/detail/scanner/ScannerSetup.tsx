import type { ComponentProps } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import { ScannerLocationSelect } from "./ScannerLocationSelect";
import { ScannerTargetPicker } from "./ScannerTargetPicker";
import { useScannerTargetCatalog } from "./useScannerTargetCatalog";
import { ScannerDestinationTiles } from "./ScannerDestinationTiles";
import { ActionTile, ActionTiles } from "../../../../../../ui/ActionTile";
import { IconMapPin } from "../../../../../../ui/MediaIcons";
import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";
import { Button } from "../../../../../../ui/Button";
import { Dialog } from "../../../../../../ui/Dialog";
import { Tabs } from "../../../../../../components/Tabs";

export function ScannerSetup({
  operatorUserId: _operatorUserId,
  sponsorOnly,
  explicitTarget,
  ready,
  locked,
  allowedActions = ["attendance", "checkout", "check"],
  onAction,
  onStart,
  ...location
}: ComponentProps<typeof ScannerLocationSelect> & {
  operatorUserId: string;
  sponsorOnly: boolean;
  explicitTarget: boolean;
  ready: boolean;
  locked: boolean;
  allowedActions?: readonly EventScanRequest["action"][];
  onAction?: (action: EventScanRequest["action"]) => void;
  onStart?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useHashQueryParam("scannerSetup", "now", ["now", "next", "browse"]);
  const [room, setRoom] = useState<{ id: string; name: string } | null>(null);
  const { catalog, error } = useScannerTargetCatalog(location.slug, open && !sponsorOnly);
  const timeZone = catalog?.timeZone;
  const city = catalog?.clockCity;
  const onTimeZone = useRef(location.onTimeZone);
  onTimeZone.current = location.onTimeZone;
  useEffect(() => {
    if (timeZone) onTimeZone.current?.({ timeZone, city: city ?? null });
  }, [timeZone, city]);
  if (sponsorOnly) return null;
  function close() {
    setOpen(false);
  }
  return (
    <>
      <ScannerDestinationTiles
        allowedActions={allowedActions}
        disabled={locked || !ready}
        onVenue={(action) => {
          location.onTarget(null);
          onAction?.(action);
          onStart?.();
        }}
        onSessions={() => {
          setRoom(null);
          setOpen(true);
        }}
      />
      {explicitTarget && location.targetId && (
        <Button
          type="button"
          variant="secondary"
          disabled={locked || !ready || (location.rooms.length > 1 && !location.roomId)}
          onClick={onStart}
        >
          Start scanning
        </Button>
      )}
      {locked && <p class="pk-muted">Finish the current scan before changing where you scan.</p>}
      <Dialog
        open={open}
        title={room ? room.name : "Choose a room"}
        confirmLabel="Close"
        cancelLabel={null}
        onConfirm={close}
        onCancel={close}
      >
        {open && (
          <div class="pk-stack">
            {error && <p role="status">{error}</p>}
            {!catalog && !error && <p role="status">Loading rooms…</p>}
            {!room && catalog && (
              <>
                <ActionTiles label="Choose a room">
                  {catalog.rooms.map((item) => (
                    <li key={item.id}>
                      <ActionTile
                        icon={<IconMapPin />}
                        label={item.name}
                        hint="Choose a session"
                        onClick={() => {
                          location.onTarget(null);
                          setRoom(item);
                          setView("now");
                        }}
                      />
                    </li>
                  ))}
                </ActionTiles>
                {catalog.rooms.length === 0 && <p>No rooms are scheduled. Choose a session from the agenda.</p>}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    location.onTarget(null);
                    setRoom({ id: "", name: "All sessions" });
                    setView("browse");
                  }}
                >
                  All sessions
                </Button>
                {catalog.roomsTruncated && <p>More rooms are available through All sessions.</p>}
              </>
            )}
            {room && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    location.onTarget(null);
                    setRoom(null);
                  }}
                >
                  Change room
                </Button>
                <Tabs
                  label="Find sessions"
                  active={view}
                  onChange={(next) => {
                    if (next === "now" || next === "next" || next === "browse") {
                      location.onTarget(null);
                      setView(next);
                    }
                  }}
                  items={[
                    { key: "now", label: "Current" },
                    { key: "next", label: "Next" },
                    { key: "browse", label: "Other" },
                  ]}
                />
                <ScannerTargetPicker
                  key={`${room.id}:${view}`}
                  {...location}
                  catalog={catalog}
                  selectedRoomId={room.id}
                  disabled={locked || !ready}
                  timeWindow={view === "now" || view === "next" ? view : undefined}
                  onTarget={(target) => {
                    if (!target) return;
                    location.onTarget(target);
                    if (room.id) location.onRoom(room.id);
                    onAction?.(
                      allowedActions.includes("attendance")
                        ? "attendance"
                        : allowedActions.includes("admission")
                          ? "admission"
                          : allowedActions.includes("check")
                            ? "check"
                            : "checkout",
                    );
                    if (room.id || (target.rooms?.length ?? 0) <= 1) {
                      close();
                      onStart?.();
                    }
                  }}
                  onRoom={(id) => {
                    location.onRoom(id);
                    close();
                    onStart?.();
                  }}
                />
              </>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
