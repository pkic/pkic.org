import { Button, type ButtonProps } from "./Button";
import "./ButtonToggle.css";
import { StrokeIcon } from "./MediaIcons";

type ViewButtonProps = ButtonProps & { [key: `data-${string}`]: string | number | boolean | undefined };

export function GridListToggle({
  value,
  onChange,
  label = "Display view",
  class: className,
  gridProps,
  listProps,
}: {
  value: "grid" | "list";
  onChange?: (value: "grid" | "list") => void;
  label?: string;
  class?: string;
  gridProps?: ViewButtonProps;
  listProps?: ViewButtonProps;
}) {
  return (
    <div class={["pk-segmented", className].filter(Boolean).join(" ")} role="group" aria-label={label}>
      <Button
        {...gridProps}
        aria-label="Grid"
        title="Grid"
        aria-pressed={value === "grid"}
        onClick={onChange ? () => onChange("grid") : gridProps?.onClick}
      >
        <StrokeIcon class="pk-toolbar-compact-icon">
          <path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z" />
        </StrokeIcon>
        <span class="pk-toolbar-control-label">Grid</span>
      </Button>
      <Button
        {...listProps}
        aria-label="List"
        title="List"
        aria-pressed={value === "list"}
        onClick={onChange ? () => onChange("list") : listProps?.onClick}
      >
        <StrokeIcon class="pk-toolbar-compact-icon">
          <path d="M5 3h9M5 8h9M5 13h9M2 3h.01M2 8h.01M2 13h.01" />
        </StrokeIcon>
        <span class="pk-toolbar-control-label">List</span>
      </Button>
    </div>
  );
}
