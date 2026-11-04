import { Field } from "../../../../../../ui/Field";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Button } from "../../../../../../ui/Button";
import type { useScannerPreferences } from "./useScannerPreferences";
import type { useScannerSound } from "./useScannerSound";

export function ScannerSoundPreferences({
  preferences,
  sound,
}: {
  preferences: ReturnType<typeof useScannerPreferences>;
  sound: ReturnType<typeof useScannerSound>;
}) {
  return (
    <div class="pk-stack pk-stack--snug">
      <Field label="Scan sounds" {...preferences.form.of("sound")} group>
        {(control) => (
          <Checkbox
            {...control}
            checked={preferences.sound}
            onChange={(event) => {
              preferences.update({ sound: event.currentTarget.checked });
              sound.unlock();
            }}
            label="Play a sound for each result"
          />
        )}
      </Field>
      <p class="pk-muted">Rising tones: success. Low tones: needs attention. Two equal tones: not yet verified.</p>
      <div class="pk-cluster">
        <Button type="button" variant="secondary" onClick={sound.test} disabled={!preferences.sound}>
          Test sound
        </Button>
      </div>
      {preferences.error && <p role="status">{preferences.error}</p>}
    </div>
  );
}
