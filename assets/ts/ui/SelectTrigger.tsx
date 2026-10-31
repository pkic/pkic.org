/** The shared combobox's non-editable control; loaded with its picker, not every public page. */
import { Button, type ButtonProps } from "./Button";
import "./Field.css";
import "./SelectTrigger.css";
export function SelectTrigger({ class: className, ...rest }: ButtonProps) {
  return (
    <Button {...rest} class={["pk-input pk-input--select pk-input--trigger", className].filter(Boolean).join(" ")} />
  );
}
