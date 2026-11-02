import { RegistrationRosterActions } from "../../components/event-registrations/RegistrationRosterActions";
import { Panel, PanelBody, PanelHeader } from "../Panel";
import type { PreviewSection } from "./PreviewShell";

export const registrationRosterActionsSection: PreviewSection = {
  id: "registration-roster-actions",
  title: "Registration exports",
  note: "The CSV download label names its scope: registered and pending registrations by default. Invalid restored filters disable it.",
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
