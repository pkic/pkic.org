/** Authenticated update host for the same flow used by public registration. */
import type { RegistrationManageReadResponse } from "../../../shared/schemas/registration";
import type { EventFormsResponse } from "../../../shared/schemas/forms";
import { RegistrationFlow, type RegistrationChange } from "./RegistrationFlow";
export type { RegistrationChange } from "./RegistrationFlow";

export function ParticipantRegistrationForm({
  data,
  forms,
  save,
  onDiscard,
}: {
  data: RegistrationManageReadResponse;
  forms: EventFormsResponse;
  save: (change: RegistrationChange) => Promise<void>;
  onDiscard: () => void;
}) {
  return <RegistrationFlow mode="update" data={data} forms={forms} save={save} onDiscard={onDiscard} />;
}
