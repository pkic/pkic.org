/**
 * The pairing code and screen ID read off a screen, as pairing and replacing
 * a screen's device both ask for them. The caller names the screen ID field
 * after its own contract.
 */
import type { ComponentChildren } from "preact";
import { SCREEN_PAIRING_CODE_LENGTH } from "../../../../../../../shared/schemas/event-screens";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";

export function ScreenCodeFields({
  pairingCode,
  screenId,
  idName,
  fields,
  onPairingCode,
  onScreenId,
  children,
}: {
  pairingCode: string;
  screenId: string;
  /** The screen ID's name in the form's contract. */
  idName: "screenId" | "newScreenId";
  fields: (name: string) => FieldPresentation;
  onPairingCode: (value: string) => void;
  onScreenId: (value: string) => void;
  /** Said right below the screen ID, such as a choice its answer from the server opened. */
  children?: ComponentChildren;
}) {
  return (
    <>
      <Field
        label="Pairing code"
        required
        help={`The large code, ${String(SCREEN_PAIRING_CODE_LENGTH)} characters.`}
        {...fields("pairingCode")}
      >
        {(control) => (
          <TextInput
            {...control}
            name="pairingCode"
            value={pairingCode}
            autocomplete="off"
            autocapitalize="characters"
            spellcheck={false}
            maxLength={SCREEN_PAIRING_CODE_LENGTH + 2}
            onInput={(event) => onPairingCode(event.currentTarget.value)}
          />
        )}
      </Field>
      <Field label="Screen ID" required help="Shown next to the code." {...fields(idName)}>
        {(control) => (
          <TextInput
            {...control}
            name={idName}
            value={screenId}
            autocomplete="off"
            autocapitalize="characters"
            spellcheck={false}
            onInput={(event) => onScreenId(event.currentTarget.value)}
          />
        )}
      </Field>
      {children}
    </>
  );
}
