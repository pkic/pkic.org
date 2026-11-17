/**
 * The join page's organization path for a person who does not represent an
 * organization yet. Adding that representation is account management, not
 * part of the application: the button opens the representation field's own
 * "Change representation" dialog, where the person adds the organization and
 * uses it, and the page then applies as that identity.
 */
import { CHANGE_REPRESENTATION_DIALOG } from "../components/RegistrationIdentitySelect";
import { useDialogQueryState } from "../hooks/useDialogQueryState";
import { Button } from "../ui/Button";

export function JoinOrganizationIdentity() {
  const [, showChoosing] = useDialogQueryState(CHANGE_REPRESENTATION_DIALOG);
  return (
    <div class="pk-stack">
      <h2>Add your organization</h2>
      <p>You apply for an organization as its representative. Add the organization you represent, then apply.</p>
      <div>
        <Button variant="primary" onClick={showChoosing}>
          Add your organization
        </Button>
      </div>
    </div>
  );
}
