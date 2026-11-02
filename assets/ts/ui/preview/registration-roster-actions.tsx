import { RegistrationRosterActions } from "../../components/event-registrations/RegistrationRosterActions";
import { Panel, PanelBody, PanelHeader } from "../Panel";
import type { PreviewSection } from "./PreviewShell";

export const registrationRosterActionsSection: PreviewSection = {
  id: "registration-roster-actions",
  title: "Registration exports",
  note: "The CSV download stays in the roster toolbar and is disabled when restored filters are invalid.",
  render: () => (
    <Panel>
      <PanelHeader title="Registrations">
        <RegistrationRosterActions
          exportsEndpoint={null}
          promotionsEndpoint="/api/v1/groups/example/events/example/registrations/promotions"
          onPromoted={() => {}}
          notify={() => {}}
        />
      </PanelHeader>
      <PanelBody>Choose a valid registration filter to download the matching registrations.</PanelBody>
    </Panel>
  ),
};
