import { Button } from "../ui/Button";
import { Toolbar, type ToolbarProps } from "../ui/Toolbar";
import { SplitButton, type SplitButtonProps } from "../ui/SplitButton";
import { IconPlus } from "./icons";

export type CollectionCreateAction =
  | {
      label: string;
      onSelect: () => void;
      disabled?: boolean;
      expanded?: boolean;
      /**
       * Writes the label beside the plus. For a collection whose "new" is not
       * self-evident from the list — a shift is a staffing period, not a row
       * of the table above it — so the reader is not left to hover a glyph.
       */
      showLabel?: boolean;
      items?: never;
    }
  | SplitButtonProps;

/** Collection actions share one native create affordance beside search and refresh. */
export function CollectionToolbar({
  createAction,
  children,
  ...props
}: ToolbarProps & {
  createAction?: CollectionCreateAction;
}) {
  const creation =
    createAction && "items" in createAction && createAction.items ? (
      <SplitButton {...createAction} />
    ) : createAction?.showLabel ? (
      <Button
        variant="primary"
        onClick={createAction.onSelect}
        disabled={createAction.disabled}
        aria-expanded={createAction.expanded}
      >
        <IconPlus />
        {createAction.label}
      </Button>
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
    );
  return (
    <Toolbar {...props} endActions={creation}>
      {children}
    </Toolbar>
  );
}
