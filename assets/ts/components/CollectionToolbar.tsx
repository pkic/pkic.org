import { Button } from "../ui/Button";
import { Toolbar, type ToolbarProps } from "../ui/Toolbar";
import { SplitButton, type SplitButtonProps } from "../ui/SplitButton";
import { IconPlus } from "./icons";

export type CollectionCreateAction =
  { label: string; onSelect: () => void; disabled?: boolean; expanded?: boolean; items?: never } | SplitButtonProps;

/** Collection actions share one native create affordance beside search and refresh. */
export function CollectionToolbar({
  createAction,
  children,
  ...props
}: ToolbarProps & {
  createAction?: CollectionCreateAction;
}) {
  return (
    <Toolbar {...props}>
      {children}
      {createAction && "items" in createAction && createAction.items ? (
        <SplitButton {...createAction} />
      ) : (
        createAction && (
          <Button
            variant="primary"
            icon
            aria-label={createAction.label}
            title={createAction.label}
            onClick={createAction.onSelect}
            disabled={createAction.disabled}
            aria-expanded={createAction.expanded}
          >
            <IconPlus />
            <span class="pk-sr-only">{createAction.label}</span>
          </Button>
        )
      )}
    </Toolbar>
  );
}
