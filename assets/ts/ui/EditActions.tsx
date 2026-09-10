import { Button } from "./Button";
import { Menu } from "./Menu";

/** Record editing is an explicit command; save and cancel replace that command in place. */
export function EditActions({
  label,
  editing,
  saving = false,
  onEdit,
  onCancel,
  saveLabel = "Save changes",
  editLabel = "Edit settings",
  direct = false,
}: {
  label: string;
  editing: boolean;
  saving?: boolean;
  onEdit: () => void;
  onCancel: () => void;
  saveLabel?: string;
  editLabel?: string;
  /** Expose the edit action directly when it is the section's only command. */
  direct?: boolean;
}) {
  return editing ? (
    <>
      <Button type="button" size="sm" disabled={saving} onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" size="sm" variant="primary" loading={saving} disabled={saving}>
        {saveLabel}
      </Button>
    </>
  ) : direct ? (
    <Button size="sm" variant="ghost" onClick={onEdit}>
      {editLabel}
    </Button>
  ) : (
    <Menu label={label} align="end" items={[{ id: "edit", label: editLabel, onSelect: onEdit }]} />
  );
}
