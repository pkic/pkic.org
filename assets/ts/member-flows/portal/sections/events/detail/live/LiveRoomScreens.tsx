import { useState } from "preact/hooks";
import { formatDateTime } from "../../../../../../../shared/format-date";
import {
  LIVE_PROGRAM_OUTPUT_DETAILS,
  LIVE_ROOM_OUTPUT_ROLE_COPY,
  liveOutputSceneLabel,
} from "../../../../../../../shared/live-room-outputs";
import {
  LIVE_ROOM_OUTPUTS_MAX,
  type LiveRoomOutput,
  type LiveRoomOutputInput,
} from "../../../../../../../shared/schemas/live-room-output-setup";
import type { LiveOverlayView } from "../../../../../../../shared/schemas/live-session-room";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import type { LiveOverlayGraphics } from "../../../../../../live-session/live-overlay-graphics";
import { CopyLinkRow } from "../../../../../../shared/widgets/copy-link-row";
import { Button } from "../../../../../../ui/Button";
import { DataTable, type DataTableColumn } from "../../../../../../ui/DataTable";
import type { MenuItem } from "../../../../../../ui/Menu";
import { RowActions } from "../../../../../../ui/RowActions";
import { SectionHeading } from "../../../../../../ui/SectionHeading";
import { liveTallyAttributes } from "./live-tally";
import { LiveOverlayGraphicsDialog } from "./LiveOverlayGraphicsDialog";
import { LiveRoomScreenDialog } from "./LiveRoomScreenDialog";
import "./live-tally.css";

/** A row of the table: Program, built in, then each screen the room sets up. */
type ScreenRow = (LiveRoomOutput & { builtIn: false }) | { key: "program"; builtIn: true };

/**
 * A physical room's screens: Program, then each screen it sets up, with its
 * code, role, scene and the link a browser source or a screen opens. Adding,
 * changing, moving or removing a screen saves the room's whole list.
 */
export function LiveRoomScreens({
  screens,
  scenes,
  expiresAt,
  link,
  onSave,
}: {
  /** The room's screens as saved, in order. */
  screens: readonly LiveRoomOutput[];
  /** The event's scenes, by name, for a screen's Scene. */
  scenes: ReadonlyArray<{ slug: string; name: string }>;
  /** When the room's links stop working. */
  expiresAt: string;
  /** A screen's link, showing all its graphics or only some. */
  link: (view: LiveOverlayView, graphics?: LiveOverlayGraphics) => string;
  /** Saves the room's whole list; rejects with the server's refusal. */
  onSave: (outputs: LiveRoomOutputInput[]) => Promise<void>;
}) {
  // The screen whose link is being narrowed to some graphics.
  const [narrowing, setNarrowing] = useState<{ view: LiveOverlayView; label: string } | null>(null);
  // The screen being added (null) or changed, while its dialog is open.
  const [editing, setEditing] = useState<LiveRoomOutput | null | undefined>(undefined);
  const [failure, setFailure] = useState<Error | null>(null);
  const saveNow = (outputs: LiveRoomOutputInput[]) => {
    setFailure(null);
    onSave(outputs).catch((cause: unknown) =>
      setFailure(cause instanceof Error ? cause : new Error("The screens could not be saved.")),
    );
  };
  const move = (from: number, to: number) => {
    const next = [...screens];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    saveNow(next);
  };
  const remove = async (screen: LiveRoomOutput) => {
    const confirmed = await confirmAction({
      title: `Remove ${screen.name}?`,
      consequences: [
        "Its link stops working, so a browser source or screen that opens it shows nothing.",
        "A studio drops it when it next opens.",
      ],
      confirmLabel: "Remove screen",
      tone: "danger",
    });
    if (confirmed) saveNow(screens.filter((entry) => entry.key !== screen.key));
  };
  const rows: ScreenRow[] = [
    { key: "program", builtIn: true },
    ...screens.map((screen) => ({ ...screen, builtIn: false as const })),
  ];
  const nameOf = (row: ScreenRow) => (row.builtIn ? LIVE_PROGRAM_OUTPUT_DETAILS.label : row.name);
  const roleOf = (row: ScreenRow) => LIVE_ROOM_OUTPUT_ROLE_COPY[row.builtIn ? "exact" : row.role];
  const actionsOf = (row: LiveRoomOutput, index: number): MenuItem[] => [
    { id: "edit", label: "Edit…", onSelect: () => setEditing(row) },
    ...(index > 0 ? [{ id: "up", label: "Move up", onSelect: () => move(index, index - 1) }] : []),
    ...(index < screens.length - 1 ? [{ id: "down", label: "Move down", onSelect: () => move(index, index + 1) }] : []),
    {
      id: "remove",
      label: "Remove…",
      danger: true,
      separatorBefore: true,
      // A room keeps at least one screen besides Program.
      disabled: screens.length === 1,
      onSelect: () => void remove(row),
    },
  ];
  const columns: DataTableColumn<ScreenRow>[] = [
    { id: "screen", header: "Screen", cell: nameOf },
    {
      id: "code",
      header: "Code",
      width: "fit",
      cell: (row) => (
        <span class="pk-live-screen-code" {...liveTallyAttributes(screens, row.key)}>
          <span class="pk-live-screen-dot" aria-hidden="true" />
          {row.builtIn ? LIVE_PROGRAM_OUTPUT_DETAILS.short : row.code}
        </span>
      ),
    },
    {
      id: "role",
      header: "Role",
      cell: (row) => (
        <span class="pk-stack pk-stack--tight">
          <span>{roleOf(row).label}</span>
          <span class="pk-small pk-muted">{roleOf(row).shows}</span>
        </span>
      ),
    },
    {
      id: "scene",
      header: "Scene",
      width: "fit",
      cell: (row) => (row.builtIn ? "From Preview" : liveOutputSceneLabel(row, scenes)),
    },
    {
      id: "link",
      header: "Link for the streaming software or the screen",
      cell: (row) => (
        <CopyLinkRow
          compact
          labelHidden
          label={nameOf(row)}
          url={link(row.key)}
          actions={
            // The speaker's screen draws its own layout, not graphics to choose from.
            !row.builtIn && row.role === "speaker" ? null : (
              <Button variant="ghost" onClick={() => setNarrowing({ view: row.key, label: nameOf(row) })}>
                Show only some graphics…
              </Button>
            )
          }
        />
      ),
    },
    {
      id: "actions",
      header: "Actions",
      headerHidden: true,
      width: "fit",
      cell: (row) =>
        row.builtIn ? null : (
          <RowActions
            subject={row.name}
            actions={actionsOf(
              row,
              screens.findIndex((entry) => entry.key === row.key),
            )}
          />
        ),
    },
  ];
  return (
    <div class="pk-stack">
      <div class="pk-cluster pk-cluster--between">
        <SectionHeading level={3}>Screens in this room</SectionHeading>
        <Button
          disabled={screens.length >= LIVE_ROOM_OUTPUTS_MAX}
          title={
            screens.length >= LIVE_ROOM_OUTPUTS_MAX
              ? `A room has at most ${LIVE_ROOM_OUTPUTS_MAX} screens besides Program.`
              : undefined
          }
          onClick={() => setEditing(null)}
        >
          + Add screen
        </Button>
      </div>
      {failure ? <ErrorAlert error={failure} /> : null}
      <div data-density="compact">
        <DataTable caption="Screens in this room" columns={columns} rows={rows} rowKey={(row) => row.key} />
      </div>
      <p class="pk-small pk-muted">
        These links stay the same and work until {formatDateTime(expiresAt)}. A studio picks up changes to the screens
        when it next opens.
      </p>
      {narrowing ? (
        <LiveOverlayGraphicsDialog
          label={narrowing.label}
          link={(graphics) => link(narrowing.view, graphics)}
          onClose={() => setNarrowing(null)}
        />
      ) : null}
      {editing !== undefined ? (
        <LiveRoomScreenDialog
          screens={screens}
          editing={editing}
          scenes={scenes}
          onSave={onSave}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </div>
  );
}
