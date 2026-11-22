/**
 * Layout for the organizer's ticket classifier: which ticket each
 * organization gets and who decided it. Staff test the classifier on the
 * listed organizations or on any name, then save the answers that are right
 * and correct the rest. Static until approved; the names are examples.
 */
import { useState } from "preact/hooks";
import { CollectionToolbar } from "../../components/CollectionToolbar";
import { DataTable, type Column } from "../../components/Table";
import { BulkBar } from "../BulkBar";
import { Button } from "../Button";
import { Radio } from "../Checkbox";
import { Chip } from "../Chip";
import { Dialog } from "../Dialog";
import { Field } from "../Field";
import { Menu } from "../Menu";
import { RowActions } from "../RowActions";
import { TextInput } from "../TextControl";
import { DialogSpecimen } from "./sections-event-screens-staff";

interface OrganizationRow {
  id: string;
  name: string;
  domain: string;
  /** The ticket that applies, or the model's answer waiting to be saved. */
  ticket: string | null;
  /** Where the ticket stands, in words. */
  status: string;
  /** A test answer staff have not saved yet. */
  unsaved?: boolean;
}

const ROWS: OrganizationRow[] = [
  { id: "1", name: "Example Bank", domain: "examplebank.test", ticket: "Attendee", status: "Model, 94% sure" },
  { id: "2", name: "Sample Security", domain: "samplesecurity.test", ticket: "Vendor", status: "Saved by staff" },
  {
    id: "3",
    name: "Specimen Systems",
    domain: "specimen.test",
    ticket: "Vendor",
    status: "Tested, 58% sure",
    unsaved: true,
  },
  {
    id: "4",
    name: "Placeholder University",
    domain: "placeholder.test",
    ticket: "Attendee",
    status: "Tested, 71% sure",
    unsaved: true,
  },
  { id: "5", name: "Fixture Labs", domain: "fixturelabs.test", ticket: null, status: "Not tested" },
];

const FILTERS = ["All", "Saved by staff", "Decided by the model", "Not decided"];

export function TicketOrganizationsPreview() {
  const [filter, setFilter] = useState("All");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(["3", "4"]));
  const columns: Column<OrganizationRow>[] = [
    {
      header: "Organization",
      cell: (row) => (
        <>
          <span class="pk-strong">{row.name}</span>
          <div class="pk-small pk-muted">{row.domain}</div>
        </>
      ),
    },
    {
      header: "Ticket",
      width: "fit",
      cell: (row) => row.ticket ?? <span class="pk-muted">Not decided</span>,
    },
    {
      header: "",
      width: "fit",
      cell: (row) => (
        <RowActions
          subject={row.name}
          status={row.status}
          actions={[
            ...(row.unsaved ? [{ id: "save", label: `Save ${row.ticket}`, onSelect: () => {} }] : []),
            { id: "set", label: "Set ticket…", onSelect: () => {} },
            { id: "test", label: row.status === "Not tested" ? "Test" : "Test again", onSelect: () => {} },
            ...(row.unsaved || !row.ticket ? [] : [{ id: "clear", label: "Clear decision", onSelect: () => {} }]),
          ]}
        />
      ),
    },
  ];
  return (
    <div class="pk-stack">
      <CollectionToolbar
        label="Organizations"
        search={{
          value: "",
          onInput: () => {},
          onSubmit: () => {},
          placeholder: "Organization or email domain",
          label: "Search organizations",
        }}
        createAction={{ label: "Test an organization", onSelect: () => {}, showLabel: true }}
      >
        <Menu
          label="Actions for listed organizations"
          align="end"
          items={[{ id: "test-all", label: "Test listed organizations", onSelect: () => {} }]}
        />
      </CollectionToolbar>
      <div class="pk-cluster">
        {FILTERS.map((label) => (
          <Chip key={label} pressed={filter === label} onToggle={() => setFilter(label)}>
            {label}
          </Chip>
        ))}
      </div>
      <BulkBar count={selected.size} total={ROWS.length} onClear={() => setSelected(new Set())}>
        <Button variant="primary">Save answers</Button>
      </BulkBar>
      <DataTable
        caption="Organizations"
        columns={columns}
        data={ROWS}
        rowKey={(row) => row.id}
        selection={{
          selected,
          onChange: setSelected,
          rowLabel: (id) => ROWS.find((row) => row.id === id)?.name ?? id,
        }}
      />
    </div>
  );
}

export function TicketOrganizationTestDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      open
      title="Test an organization"
      closeLabel="Close test"
      confirmLabel="Save Vendor"
      cancelLabel="Close"
      onConfirm={onClose}
      onCancel={onClose}
    >
      <div class="pk-stack">
        <div class="pk-grid pk-grid--tight">
          <Field label="Organization">{(control) => <TextInput {...control} value="Specimen Systems" />}</Field>
          <Field label="Email domain (optional)">{(control) => <TextInput {...control} value="specimen.test" />}</Field>
        </div>
        <div class="pk-cluster">
          <Button>Test</Button>
          <span class="pk-small pk-muted">Answered in 240 ms</span>
        </div>
        <fieldset class="pk-fieldset pk-field">
          <legend class="pk-field__label">Ticket</legend>
          <Radio name="ticket-test" value="vendor" label="Vendor" hint="Model: 58% sure" defaultChecked />
          <Radio name="ticket-test" value="attendee" label="Attendee" hint="Model: 42% sure" />
        </fieldset>
        <p class="pk-small pk-muted">
          Below the 75% threshold: unless you save a ticket, people from this organization choose their own.
        </p>
      </div>
    </Dialog>
  );
}

export function TicketOrganizationTestSpecimen() {
  return (
    <DialogSpecimen label="Test an organization" dialog={(close) => <TicketOrganizationTestDialog onClose={close} />} />
  );
}
