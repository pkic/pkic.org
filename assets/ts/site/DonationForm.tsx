import { Panel, PanelBody } from "../ui/Panel";
import { DonationWidget, type DonationWidgetOptions } from "./DonationWidget";

export function DonationForm({
  options,
}: {
  options: DonationWidgetOptions & { heading?: string; description?: string };
}) {
  return (
    <Panel data-module="shared/donation-form">
      <PanelBody class="pk-stack">
        {options.heading && <h3 class="pk-panel__title">{options.heading}</h3>}
        {options.description && <p class="pk-muted">{options.description}</p>}
        <p class="pk-small">A receipt will be issued by email after your donation is processed.</p>
        <DonationWidget opts={options} />
      </PanelBody>
    </Panel>
  );
}
