import { ContactOrganization } from "../../components/ContactOrganization";
import { PERSONAL_EMAIL_ADDRESS_LABEL } from "../../../shared/email-first-copy";
import type { PreviewSection } from "./PreviewShell";

export const contactOrganizationSection: PreviewSection = {
  id: "contact-organization",
  title: "Contact organization",
  note: "Organizers see the personal-address warning; sponsor lists receive one organization text field.",
  render: () => (
    <div class="pk-stack">
      <div>
        <p>Organizer: work address</p>
        <ContactOrganization organization="Synthetic Trust Services" personalEmail={false} />
      </div>
      <div>
        <p>Organizer: personal address</p>
        <ContactOrganization organization="Withheld organization" personalEmail />
      </div>
      <div>
        <p>Organizer: work address awaiting priority verification</p>
        <ContactOrganization organization="Synthetic Trust Services" personalEmail={false} handledLast />
      </div>
      <div>
        <p>Sponsor: personal address</p>
        <p>{PERSONAL_EMAIL_ADDRESS_LABEL}</p>
      </div>
    </div>
  ),
};
