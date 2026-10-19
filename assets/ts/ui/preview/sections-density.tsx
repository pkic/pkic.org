/**
 * Dense-surface specimens: the places a button used to ask for `size="sm"`.
 *
 * Each one is a surface that is dense by nature, so the surface sets compact
 * density once and every control inside inherits it.
 */

import "../../member-flows/portal/sections/events/detail/live/studio/TimePanel.css";
import { Button } from "../Button";
import { DataTable } from "../DataTable";
import { useState } from "preact/hooks";
import { useHashQueryParam } from "../../hooks/useHashQueryParam";
import { MarkdownEditor } from "../../components/markdown-editor/MarkdownInput";
import { Field } from "../Field";
import { FormSection } from "../FormSection";
import { Menu } from "../Menu";
import { Select, Textarea, TextInput } from "../TextControl";
import { SplitButton } from "../SplitButton";
import { CollectionToolbar } from "../../components/CollectionToolbar";
import { IconRefresh } from "../../components/icons";
import { GridListToggle } from "../GridListToggle";
import { StrokeIcon } from "../MediaIcons";
import { Meter } from "../Meter";
import { RowActions } from "../RowActions";
import type { PreviewSection } from "./PreviewShell";

interface Invitation {
  id: string;
  email: string;
  sent: string;
}

const INVITATIONS: Invitation[] = [
  { id: "i1", email: "ana.ferreira@example.org", sent: "Oct 2, 2026" },
  { id: "i2", email: "carol.davis@example.org", sent: "Oct 4, 2026" },
  { id: "i3", email: "tomas.riedel@example.org", sent: "Oct 9, 2026" },
];

function TableActionsSpecimen() {
  return (
    <div class="pk-table-list">
      <DataTable<Invitation>
        caption="Invitations and what can be done to them"
        columns={[
          { id: "email", header: "Invitee", cell: (row) => row.email },
          { id: "sent", header: "Sent", cell: (row) => row.sent, width: "fit" },
          {
            id: "actions",
            header: "Actions",
            headerHidden: true,
            align: "end",
            cell: (row) => (
              <div class="pk-row-actions">
                <Button aria-label={`Resend, ${row.email}`}>Resend</Button>
                <RowActions
                  subject={row.email}
                  actions={[{ id: "revoke", label: "Revoke invitation", onSelect: () => {} }]}
                />
              </div>
            ),
          },
        ]}
        rows={INVITATIONS}
        rowKey={(row) => row.id}
      />
    </div>
  );
}

function StudioTimerSpecimen() {
  return (
    <div class="pk-studio-time" data-density="compact">
      <ul class="pk-studio-time__list" aria-label="Timers">
        <li class="pk-studio-time__row">
          <span class="pk-studio-time__name">Session</span>
          <output class="pk-studio-time__value">12:40</output>
          <span class="pk-studio-time__detail">Session ends 15:45</span>
          <Meter class="pk-studio-time__meter" label="Session time used" value={30} max={45} tone="accent" />
          <span class="pk-studio-time__controls">
            <Button icon variant="secondary" aria-label="Pause Session" title="Pause">
              <StrokeIcon>
                <path d="M5.5 3v10M10.5 3v10" />
              </StrokeIcon>
            </Button>
            <Button aria-label="Take a minute from Session">−1m</Button>
            <Button aria-label="Add a minute to Session">+1m</Button>
            <Menu label="Session timer" align="end" items={[{ id: "reset", label: "Reset", onSelect: () => {} }]} />
          </span>
        </li>
      </ul>
    </div>
  );
}

/** A toolbar is compact by itself; the comfortable row opts out to show both heights. */
function ControlRow({ density }: { density: "compact" | "comfortable" }) {
  const [query, setQuery] = useState("");
  const [view, setView] = useHashQueryParam("galleryDensityView", "list", ["grid", "list"] as const);
  return (
    <CollectionToolbar
      label={`Control row, ${density}`}
      data-density={density}
      search={{ value: query, placeholder: "Name or email", onInput: setQuery, onSubmit: () => {} }}
      createAction={{ label: "Add user", onSelect: () => {} }}
    >
      <div class="pk-preview__narrow">
        <Select aria-label="Status">
          <option>Any status</option>
          <option>Active</option>
        </Select>
      </div>
      {/* Sort is the list's card menu: a secondary split control with a label, as `ColumnCardMenu` draws it. */}
      <SplitButton
        variant="secondary"
        label="Sort users"
        icon={
          <>
            <StrokeIcon class="pk-toolbar-compact-icon">
              <path d="M3 2v12m-2-2 2 2 2-2M8 3h6M8 8h4M8 13h2" />
            </StrokeIcon>
            <span class="pk-toolbar-control-label">Sort</span>
          </>
        }
        items={[{ id: "name", label: "Name", onSelect: () => {} }]}
      />
      <Menu label="Choose columns" align="end" items={[{ id: "org", label: "Organization", onSelect: () => {} }]} />
      <Button>Manage access</Button>
      <GridListToggle value={view} onChange={setView} />
      <Button variant="secondary" icon title="Refresh users">
        <IconRefresh />
        <span class="pk-sr-only">Refresh</span>
      </Button>
      <SplitButton
        label="More ways to add"
        defaultAction={{ label: "Add user", onSelect: () => {} }}
        items={[{ id: "import", label: "Import users", onSelect: () => {} }]}
      />
    </CollectionToolbar>
  );
}

function FieldSpacingSpecimen() {
  return (
    <div class="pk-preview__narrow">
      <FormSection title="Details">
        <fieldset class="pk-fieldset">
          <Field label="Organization name" required>
            {(control) => <TextInput {...control} />}
          </Field>
          <Field label="Description">
            {(control) => (
              <MarkdownEditor
                variant="compact"
                {...control}
                name="description"
                label="Description"
                initialValue=""
                onChange={() => {}}
              />
            )}
          </Field>
        </fieldset>
        <Field label="Role" help="Shown on the member's profile.">
          {(control) => (
            <Select {...control}>
              <option>Member</option>
              <option>Working Group Lead</option>
            </Select>
          )}
        </Field>
        <Field label="Notes" state="invalid" message="Notes must be at least 10 characters.">
          {(control) => <Textarea {...control} />}
        </Field>
      </FormSection>
    </div>
  );
}

export const densitySections: PreviewSection[] = [
  {
    id: "field-spacing",
    title: "Field spacing",
    note: "A label sits close to its own control; fields sit twice as far apart, whether or not a fieldset wraps them.",
    render: () => <FieldSpacingSpecimen />,
  },
  {
    id: "control-row",
    title: "Control row",
    note: "Every control that can share a toolbar row, one height at either density.",
    render: () => (
      <div class="pk-stack">
        <p class="pk-small pk-muted">Compact: what every toolbar uses (27.5px).</p>
        <ControlRow density="compact" />
        <p class="pk-small pk-muted">Comfortable: the same row outside a toolbar (33.7px).</p>
        <ControlRow density="comfortable" />
      </div>
    ),
  },
  {
    id: "density-table-actions",
    title: "Dense table actions",
    note: "An inline row action beside the row menu.",
    render: () => <TableActionsSpecimen />,
  },
  {
    id: "density-studio-timer",
    title: "Studio control strip",
    note: "A timer row's transport controls.",
    render: () => <StudioTimerSpecimen />,
  },
];
