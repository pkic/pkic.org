/**
 * The address a registration's emails go to, read-only in its edit form.
 *
 * The address belongs to the chosen representation, so it changes with the
 * representation rather than being typed here.
 */
import { DescriptionList } from "../../ui/DescriptionList";

export function RegistrationEmailAddress({ email }: { email: string }) {
  return (
    <div class="pk-stack pk-stack--snug">
      <DescriptionList items={[{ term: "Email address", value: email }]} />
      <p class="pk-muted pk-small">Registration emails go to the address of your representation.</p>
    </div>
  );
}
