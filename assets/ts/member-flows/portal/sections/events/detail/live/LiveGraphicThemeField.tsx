import {
  LIVE_GRAPHIC_THEMES,
  LIVE_GRAPHIC_THEME_LABELS,
  type LiveGraphicTheme,
} from "../../../../../../../shared/live-graphic-theme";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";

/**
 * A themed graphic's colors, as one choice in its settings: the same list and
 * names for every graphic that has a theme, or the part of it a graphic with
 * white type takes.
 */
export function LiveGraphicThemeField<Theme extends LiveGraphicTheme = LiveGraphicTheme>({
  name,
  value,
  themes = LIVE_GRAPHIC_THEMES as readonly LiveGraphicTheme[] as readonly Theme[],
  presentation,
  help,
  onChange,
}: {
  name: string;
  value: Theme;
  themes?: readonly Theme[];
  presentation: FieldPresentation;
  help?: string;
  onChange: (theme: Theme) => void;
}) {
  return (
    <Field label="Colors" help={help} {...presentation}>
      {(control) => (
        <Select
          {...control}
          name={name}
          value={value}
          onChange={(event) => {
            const chosen = themes.find((theme) => theme === event.currentTarget.value);
            if (chosen) onChange(chosen);
          }}
        >
          {themes.map((theme) => (
            <option key={theme} value={theme}>
              {LIVE_GRAPHIC_THEME_LABELS[theme]}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
