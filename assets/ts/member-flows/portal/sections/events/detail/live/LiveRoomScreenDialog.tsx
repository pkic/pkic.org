import { useState } from "preact/hooks";
import {
  LIVE_ROOM_OUTPUT_ROLE_COPY,
  LIVE_ROOM_OUTPUT_SCENE_DEFAULT,
} from "../../../../../../../shared/live-room-outputs";
import {
  LIVE_ROOM_OUTPUT_CODE_MAX,
  LIVE_ROOM_OUTPUT_ROLES,
  liveRoomOutputsRequestSchema,
  type LiveRoomOutput,
  type LiveRoomOutputInput,
  type LiveRoomOutputRole,
} from "../../../../../../../shared/schemas/live-room-output-setup";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Alert } from "../../../../../../ui/Alert";
import { Radio } from "../../../../../../ui/Checkbox";
import { Dialog } from "../../../../../../ui/Dialog";
import { Field } from "../../../../../../ui/Field";
import { Select, TextInput } from "../../../../../../ui/TextControl";

const BLANK: LiveRoomOutputInput = { name: "", code: "", role: "exact", scene: null };

/** The control names the dialog's fields carry; the contract checks them as one row of the room's whole list. */
const FIELDS = ["name", "code", "role", "scene"] as const;

/** What a role shows; the speaker's role says which screen holds it while another one does. */
function roleHint(role: LiveRoomOutputRole, speaker: LiveRoomOutput | undefined): string {
  const copy = LIVE_ROOM_OUTPUT_ROLE_COPY[role];
  if (role === "speaker" && speaker) return `${copy.shows}. ${speaker.name} already has this role.`;
  return `${copy.shows}. ${copy.hint}`;
}

/**
 * Adds a screen to the room or changes one: its name, the short code the
 * studio shows, its role and the scene it draws. The dialog checks the screen
 * as part of the room's whole list, so a code already in use says so on the
 * field before anything is sent.
 */
export function LiveRoomScreenDialog({
  screens,
  editing,
  scenes,
  onSave,
  onClose,
}: {
  /** The room's screens as saved, in order. */
  screens: readonly LiveRoomOutput[];
  /** The screen being changed, or null to add one. */
  editing: LiveRoomOutput | null;
  scenes: ReadonlyArray<{ slug: string; name: string }>;
  /** Saves the room's whole list; rejects with the server's refusal. */
  onSave: (outputs: LiveRoomOutputInput[]) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<LiveRoomOutputInput>(() => (editing ? { ...editing } : BLANK));
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");
  const index = editing ? screens.findIndex((screen) => screen.key === editing.key) : screens.length;
  const outputs: LiveRoomOutputInput[] = editing
    ? screens.map((screen, position) => (position === index ? draft : screen))
    : [...screens, draft];
  const form = useContractForm(
    liveRoomOutputsRequestSchema,
    { outputs },
    {
      fieldOf: (name) => ((FIELDS as readonly string[]).includes(name) ? `outputs.${index}.${name}` : name),
    },
  );
  // A room has one speaker screen, so the role stays closed while another screen holds it.
  const speaker = screens.find((screen) => screen.role === "speaker" && screen.key !== editing?.key);
  const change = (patch: Partial<LiveRoomOutputInput>) => setDraft((current) => ({ ...current, ...patch }));
  const title = editing ? `Edit ${editing.name}` : "Add screen";
  async function save() {
    if (saving) return;
    const checked = form.submit();
    if (!checked.data) return setFailure(checked.formMessage ?? "");
    setSaving(true);
    setFailure("");
    try {
      await onSave(checked.data.outputs);
      onClose();
    } catch (error) {
      setFailure(form.refuse(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      title={title}
      confirmLabel={editing ? "Save screen" : "Add screen"}
      confirmDisabled={saving}
      onConfirm={() => void save()}
      onCancel={onClose}
    >
      <form
        noValidate
        class="pk-stack"
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {failure ? <Alert tone="danger">{failure}</Alert> : null}
        <Field label="Name" {...form.of(`outputs.${index}.name`)}>
          {(control) => (
            <TextInput
              {...control}
              name="name"
              value={draft.name}
              autoComplete="off"
              onInput={(event) => change({ name: event.currentTarget.value })}
            />
          )}
        </Field>
        <Field
          label="Code"
          help={`Up to ${LIVE_ROOM_OUTPUT_CODE_MAX} characters, shown on take buttons and monitors.`}
          {...form.of(`outputs.${index}.code`)}
        >
          {(control) => (
            <TextInput
              {...control}
              name="code"
              value={draft.code}
              autoComplete="off"
              autoCapitalize="characters"
              spellcheck={false}
              onInput={(event) => change({ code: event.currentTarget.value })}
            />
          )}
        </Field>
        <Field label="Role" group {...form.ofGroup(`outputs.${index}.role`)}>
          {() => (
            <div class="pk-stack pk-stack--snug">
              {LIVE_ROOM_OUTPUT_ROLES.map((role) => (
                <Radio
                  key={role}
                  name="role"
                  value={role}
                  label={LIVE_ROOM_OUTPUT_ROLE_COPY[role].label}
                  hint={roleHint(role, speaker)}
                  checked={draft.role === role}
                  disabled={role === "speaker" && speaker !== undefined}
                  onChange={() => change({ role, scene: role === "speaker" ? null : draft.scene })}
                />
              ))}
            </div>
          )}
        </Field>
        {draft.role === "speaker" ? null : (
          <Field label="Scene" {...form.of(`outputs.${index}.scene`)}>
            {(control) => (
              <Select
                {...control}
                name="scene"
                value={draft.scene ?? ""}
                onChange={(event) => change({ scene: event.currentTarget.value || null })}
              >
                <option value="">
                  {LIVE_ROOM_OUTPUT_SCENE_DEFAULT[draft.role as Exclude<LiveRoomOutputRole, "speaker">]}
                </option>
                {scenes.map((scene) => (
                  <option key={scene.slug} value={scene.slug}>
                    Always {scene.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </form>
    </Dialog>
  );
}
