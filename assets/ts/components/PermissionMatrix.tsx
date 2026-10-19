/**
 * Permissions as areas against Read and Write: one checkbox per column under
 * a shared header, a first row for every area at once, then one row per area.
 * Only an area with more than one permission behind a column opens to list
 * them, each with its checkbox in its own column, for exceptions; a partly
 * ticked area reads as custom.
 *
 * Read only, the same rows show a check where a column is fully held and
 * leave out the areas with nothing held.
 */
import { useState } from "preact/hooks";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { IconCheckmark, IconChevron } from "../ui/MediaIcons";
import {
  type Access,
  accessState,
  hasSeveralOfOneAccess,
  isCustom,
  type LeveledPermission,
  withAccess,
} from "./permission-access";
import "./PermissionMatrix.css";

export interface MatrixPermission extends LeveledPermission {
  label: string;
  /** A line under the permission in the opened list. */
  hint?: string;
}

export interface MatrixArea {
  key: string;
  label: string;
  permissions: readonly MatrixPermission[];
  /** A line under an area that does not open, in place of its count. */
  note?: string;
}

const ACCESS: readonly Access[] = ["read", "write"];
const ACCESS_LABELS: Record<Access, string> = { read: "Read", write: "Write" };
const PARTLY = "Some";

function countLabel(permissions: readonly LeveledPermission[], selected: ReadonlySet<string>): string {
  const chosen = permissions.filter((item) => selected.has(item.permission)).length;
  const count = `${chosen} of ${permissions.length}`;
  return isCustom(permissions, selected) ? `Custom, ${count}` : count;
}

/** The Read and Write cells of one row; a kind the row has nothing of is shown disabled, or left empty when read only. */
function AccessCells({
  label,
  permissions,
  selected,
  disabled,
  readOnly,
  onSelect,
}: {
  label: string;
  permissions: readonly LeveledPermission[];
  selected: ReadonlySet<string>;
  disabled: boolean;
  readOnly: boolean;
  onSelect: (next: Set<string>) => void;
}) {
  return (
    <>
      {ACCESS.map((access) => {
        const state = accessState(permissions, access, selected);
        const cell = `pk-permission-matrix__cell pk-permission-matrix__cell--${access}`;
        if (readOnly) {
          const reading = state === "all" ? "yes" : state === "some" ? PARTLY.toLowerCase() : "no";
          return (
            <span key={access} class={cell}>
              {state === "all" && <IconCheckmark aria-hidden="true" />}
              {state === "some" && (
                <span class="pk-small pk-muted" aria-hidden="true">
                  {PARTLY}
                </span>
              )}
              <span class="pk-sr-only">{`${ACCESS_LABELS[access]}: ${reading}`}</span>
            </span>
          );
        }
        return (
          <Checkbox
            key={access}
            class={cell}
            label={<span class="pk-sr-only">{`${ACCESS_LABELS[access]}: ${label}`}</span>}
            checked={state === "all"}
            disabled={disabled || state === "unavailable"}
            onChange={(event) => onSelect(withAccess(selected, permissions, access, event.currentTarget.checked))}
          />
        );
      })}
    </>
  );
}

export function PermissionMatrix({
  areas,
  selected,
  disabled = false,
  readOnly = false,
  onSelect = () => undefined,
}: {
  areas: readonly MatrixArea[];
  selected: ReadonlySet<string>;
  disabled?: boolean;
  readOnly?: boolean;
  onSelect?: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const shown = readOnly
    ? areas.filter((area) => area.permissions.some((item) => selected.has(item.permission)))
    : areas;
  const all = shown.flatMap((area) => area.permissions);

  function tick(permission: string, on: boolean): void {
    const next = new Set(selected);
    if (on) next.add(permission);
    else next.delete(permission);
    onSelect(next);
  }

  function disclose(key: string): void {
    const next = new Set(open);
    if (!next.delete(key)) next.add(key);
    setOpen(next);
  }

  return (
    <div>
      <div class="pk-permission-matrix__header">
        <div class="pk-permission-matrix__columns" aria-hidden="true">
          <span class="pk-permission-matrix__cell--read">Read</span>
          <span class="pk-permission-matrix__cell--write">Write</span>
        </div>
        <div class="pk-permission-matrix__row">
          <div class="pk-permission-matrix__name">
            <span class="pk-strong">All areas</span>
            <span class="pk-small pk-muted">{countLabel(all, selected)} permissions</span>
          </div>
          <AccessCells
            label="All areas"
            permissions={all}
            selected={selected}
            disabled={disabled}
            readOnly={readOnly}
            onSelect={onSelect}
          />
        </div>
      </div>
      <ul class="pk-permission-matrix__areas">
        {shown.map((area) => {
          const detailed = hasSeveralOfOneAccess(area.permissions);
          const expanded = detailed && open.has(area.key);
          const bodyId = `pk-permission-matrix-${area.key}`;
          const listed = readOnly ? area.permissions.filter((item) => selected.has(item.permission)) : area.permissions;
          return (
            <li key={area.key} class="pk-permission-matrix__area">
              <div class="pk-permission-matrix__row">
                <div class="pk-permission-matrix__name">
                  <span class="pk-strong">{area.label}</span>
                  {detailed ? (
                    <span class="pk-small pk-muted">{countLabel(area.permissions, selected)}</span>
                  ) : (
                    area.note && <span class="pk-small pk-muted">{area.note}</span>
                  )}
                </div>
                <AccessCells
                  label={area.label}
                  permissions={area.permissions}
                  selected={selected}
                  disabled={disabled}
                  readOnly={readOnly}
                  onSelect={onSelect}
                />
                {detailed && (
                  <Button
                    variant="ghost"
                    icon
                    aria-label={`${area.label} permissions`}
                    title={`${area.label} permissions`}
                    aria-expanded={expanded}
                    aria-controls={bodyId}
                    onClick={() => disclose(area.key)}
                  >
                    <IconChevron pointing="down" class="pk-permission-matrix__chevron" />
                  </Button>
                )}
              </div>
              {detailed && (
                <ul id={bodyId} class="pk-permission-matrix__permissions" hidden={!expanded}>
                  {listed.map((item) => {
                    const cell = `pk-permission-matrix__cell pk-permission-matrix__cell--${item.access}`;
                    const held = selected.has(item.permission);
                    return (
                      <li key={item.permission} class="pk-permission-matrix__row">
                        <div class="pk-permission-matrix__name">
                          <span>{item.label}</span>
                          {item.hint && <span class="pk-small pk-muted">{item.hint}</span>}
                        </div>
                        {readOnly ? (
                          <span class={cell}>
                            <IconCheckmark aria-hidden="true" />
                            <span class="pk-sr-only">{`${ACCESS_LABELS[item.access]}: yes`}</span>
                          </span>
                        ) : (
                          <Checkbox
                            class={cell}
                            label={<span class="pk-sr-only">{item.label}</span>}
                            checked={held}
                            disabled={disabled}
                            onChange={(event) => tick(item.permission, event.currentTarget.checked)}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
