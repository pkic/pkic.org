import { useState } from "preact/hooks";
import { scannerPreferencesSchema } from "../../../../../../../shared/schemas/event-scanner-preferences";
import { useContractForm } from "../../../../../../hooks/useContractForm";

const key = "pkic-scanner-preferences";
function readPreferences() {
  try {
    return scannerPreferencesSchema.parse(JSON.parse(localStorage.getItem(key) ?? "{}"));
  } catch {
    return scannerPreferencesSchema.parse({});
  }
}
/** Device preferences are immediate and explicit about storage failures. No attendee data is stored here. */
export function useScannerPreferences() {
  const [value, setValue] = useState(readPreferences);
  const [error, setError] = useState("");
  const form = useContractForm(scannerPreferencesSchema, value);
  function update(next: Partial<typeof value>) {
    const parsed = scannerPreferencesSchema.safeParse({ ...value, ...next });
    if (!parsed.success) return;
    setValue(parsed.data);
    try {
      localStorage.setItem(key, JSON.stringify(parsed.data));
      setError("");
    } catch {
      setError("Preferences apply now but could not be saved in this browser.");
    }
  }
  return { ...value, update, setSound: (sound: boolean) => update({ sound }), form, error };
}
