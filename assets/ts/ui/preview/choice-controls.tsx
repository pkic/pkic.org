import { Checkbox, Radio } from "../Checkbox";
import type { PreviewSection } from "./PreviewShell";

export const choiceControlsSection: PreviewSection = {
  id: "choice-controls",
  title: "Choice controls",
  render: () => (
    <div class="pk-stack">
      <Radio name="preview-choice" value="selected" label="Selected option" defaultChecked />
      <Radio name="preview-choice" value="available" label="Available option" />
      <Radio name="preview-disabled-choice" label="Unavailable option" disabled />
      <Checkbox label="Selected checkbox" defaultChecked />
      <Checkbox label="Enabled switch" switch defaultChecked />
    </div>
  ),
};
