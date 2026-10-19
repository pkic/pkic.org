import {
  LIVE_GRAPHIC_THEMES,
  LIVE_GRAPHIC_THEME_LABELS,
  liveGraphicThemeSchema,
  type LiveGraphicTheme,
} from "../../../../../../../shared/live-graphic-theme";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";

/** A themed graphic's colors, as one choice in its settings: the same list for every graphic that has a theme. */
export function LiveGraphicThemeField({
  name,
  value,
  presentation,
  help,
  onChange,
}: {
  name: string;
  value: LiveGraphicTheme;
  presentation: FieldPresentation;
  help?: string;
  onChange: (theme: LiveGraphicTheme) => void;
}) {
  return (
    <Field label="Colors" help={help} {...presentation}>
      {(control) => (
        <Select
          {...control}
          name={name}
          value={value}
          onChange={(event) => onChange(liveGraphicThemeSchema.parse(event.currentTarget.value))}
        >
          {LIVE_GRAPHIC_THEMES.map((theme) => (
            <option key={theme} value={theme}>
              {LIVE_GRAPHIC_THEME_LABELS[theme]}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
