/**
 * The Graphics panel's check-in code: which of the event's codes to show
 * (this session's own, a room's, or a day's check-in or check-out) and where:
 * Preview, Program and every auxiliary output, the projector included.
 */
import { DEFAULT_LIVE_CHECK_IN_TEXT } from "../../../../../../../shared/schemas/live-session-graphic-settings";
import { useState } from "preact/hooks";
import {
  attendancePointSelectionSchema,
  type AttendancePointSelection,
} from "../../../../../../../shared/attendance-points";
import {
  attendancePointsResponseSchema,
  type AttendancePoint,
  type LiveCheckInGraphic,
} from "../../../../../../../shared/schemas/event-attendance-points";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { useData } from "../../../../../../hooks/useData";
import { getJson } from "../../../../../../shared/api-client";
import { Dialog } from "../../../../../../ui/Dialog";
import { Field } from "../../../../../../ui/Field";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Select, Textarea } from "../../../../../../ui/TextControl";
import { LiveGraphicRow } from "./LiveGraphicRow";
import { LiveGraphicThemeField } from "./LiveGraphicThemeField";
import {
  LIVE_GRAPHIC_THEME_DEFAULTS,
  LIVE_GRAPHIC_THEME_LABELS,
  type LiveGraphicTheme,
} from "../../../../../../../shared/live-graphic-theme";
import { liveCheckInChoiceSchema, type LiveCheckInChoice } from "../../../../../../../shared/schemas/live-session-room";
import { LiveLayerTargets } from "./LiveLayerTargets";
import type { LiveTargets } from "./live-output-targets";

function selectionOf(point: AttendancePoint): AttendancePointSelection {
  return attendancePointSelectionSchema.parse(
    point.kind === "room"
      ? { kind: "room", roomId: point.room!.id }
      : point.kind === "session"
        ? { kind: "session", occurrenceId: point.session!.id }
        : { kind: point.kind, dayDate: point.dayDate },
  );
}

const keyOf = (selection: AttendancePointSelection) => JSON.stringify(selection);

/** This session's own code first, then the venue and room codes the organizers print. */
async function loadCodes(slug: string, occurrenceId: string): Promise<LiveCheckInGraphic[]> {
  const base = `/api/v1/events/${encodeURIComponent(slug)}/attendance/points`;
  const [session, printed] = await Promise.all([
    getJson(
      `${base}?kind=session&occurrenceId=${encodeURIComponent(occurrenceId)}&limit=1`,
      attendancePointsResponseSchema,
    ),
    getJson(`${base}?limit=200`, attendancePointsResponseSchema),
  ]);
  return [...session.points, ...printed.points].map((point) => ({
    selection: selectionOf(point),
    label: point.kind === "session" ? `This session: ${point.label}` : point.label,
    path: point.path,
  }));
}

export function LiveCheckInControls({
  targets,
  slug,
  occurrenceId,
}: {
  targets: LiveTargets;
  slug: string;
  occurrenceId: string;
}) {
  const codes = useData(() => loadCodes(slug, occurrenceId), [slug, occurrenceId]);
  const shown = targets.state.preview.checkIn ?? (targets.programActive ? targets.state.stage.checkIn : null);
  const [chosen, setChosen] = useState<string | null>(shown ? keyOf(shown.selection) : null);
  const [theme, setTheme] = useState<LiveGraphicTheme>(shown?.theme ?? LIVE_GRAPHIC_THEME_DEFAULTS.checkIn);
  const [text, setText] = useState(shown?.text ?? DEFAULT_LIVE_CHECK_IN_TEXT);
  const [open, setOpen] = useState(false);
  const options = codes.data ?? [];
  const current = options.find((code) => keyOf(code.selection) === chosen) ?? options[0] ?? null;
  const [draft, setDraft] = useState<Partial<LiveCheckInChoice>>({});
  const form = useContractForm(liveCheckInChoiceSchema, draft);
  return (
    <LiveGraphicRow
      name="Check-in code"
      detail={
        current
          ? `${current.label} · ${LIVE_GRAPHIC_THEME_LABELS[theme]}`
          : codes.loading
            ? "Loading codes…"
            : "No check-in codes. Attendance access is needed to show them."
      }
      settings={{
        label: "Check-in code settings",
        disabled: options.length === 0,
        onOpen: () => {
          setDraft({ checkIn: current?.selection, checkInTheme: theme, checkInText: text });
          form.reset();
          setOpen(true);
        },
      }}
    >
      {current && (
        <LiveLayerTargets
          targets={targets}
          subject="check-in code"
          layer={{ kind: "checkIn", checkIn: { ...current, theme, text } }}
        />
      )}
      {open && (
        <Dialog
          open
          title="Check-in code"
          confirmLabel="Save"
          onConfirm={() => {
            const checked = form.submit();
            if (checked.data) {
              setChosen(keyOf(checked.data.checkIn));
              setTheme(checked.data.checkInTheme);
              setText(checked.data.checkInText);
              setOpen(false);
            }
          }}
          onCancel={() => setOpen(false)}
        >
          <form noValidate {...form.handlers} class="pk-stack" onSubmit={(event) => event.preventDefault()}>
            <Field label="Code to show" {...form.of("checkIn")}>
              {(control) => (
                <Select
                  {...control}
                  name="checkIn"
                  value={draft.checkIn ? keyOf(draft.checkIn) : ""}
                  onChange={(event) => {
                    const checkIn = attendancePointSelectionSchema.parse(JSON.parse(event.currentTarget.value));
                    setDraft((previous) => ({ ...previous, checkIn }));
                  }}
                >
                  {options.map((code) => (
                    <option key={keyOf(code.selection)} value={keyOf(code.selection)}>
                      {code.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Checkbox
              label="Show check-in instruction"
              checked={draft.checkInText?.visible ?? text.visible}
              {...form.of("checkInText.visible")}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  checkInText: { ...(previous.checkInText ?? text), visible: event.currentTarget.checked },
                }))
              }
            />
            <Field
              label="Instruction"
              help="Bold and italic are supported. Use {{checkIn.label}} for the selected code's name."
              {...form.of("checkInText.template")}
            >
              {(control) => (
                <Textarea
                  {...control}
                  value={draft.checkInText?.template ?? text.template}
                  onInput={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      checkInText: { ...(previous.checkInText ?? text), template: event.currentTarget.value },
                    }))
                  }
                />
              )}
            </Field>
            <LiveGraphicThemeField
              name="checkInTheme"
              value={draft.checkInTheme ?? theme}
              presentation={form.of("checkInTheme")}
              help="The code takes these colors too. Black on white scans on every phone; a light code on a dark or transparent ground scans on current phones when the picture behind it is dark and calm."
              onChange={(checkInTheme) => setDraft((previous) => ({ ...previous, checkInTheme }))}
            />
          </form>
        </Dialog>
      )}
    </LiveGraphicRow>
  );
}
