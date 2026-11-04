import { useState } from "preact/hooks";
import { eventRegistrationPromotionsResponseSchema } from "../../../shared/schemas/event-registrations";
import { postJson } from "../../shared/api-client";
import { RegistrationOutputActions } from "./RegistrationOutputActions";
import type { BadgePrintAction } from "../../../shared/schemas/event-badge-printing";
import { Menu } from "../../ui/Menu";

export function RegistrationRosterActions({
  promotionsEndpoint,
  exportsEndpoint,
  sponsorExportUrl,
  exportMatchesFilters = false,
  onPromoted,
  notify,
  onPrintAllMatching,
}: {
  promotionsEndpoint: string;
  exportsEndpoint: string | null;
  sponsorExportUrl?: string | null;
  exportHasStatusFilter?: boolean;
  exportMatchesFilters?: boolean;
  onPromoted: () => void | Promise<void>;
  notify: (message: string, kind: "success" | "error") => void;
  onPrintAllMatching?: (action: BadgePrintAction) => void;
}) {
  const [promoting, setPromoting] = useState(false);

  async function runWaitlistPromotions() {
    setPromoting(true);
    try {
      await postJson(promotionsEndpoint, {}, eventRegistrationPromotionsResponseSchema);
      notify("Waitlist promotions run", "success");
      await onPromoted();
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setPromoting(false);
    }
  }

  return (
    <>
      <Menu
        label="Registration actions"
        align="end"
        items={[
          {
            id: "waitlist-promotions",
            label: promoting ? "Running promotions…" : "Run waitlist promotions",
            disabled: promoting,
            onSelect: () => void runWaitlistPromotions(),
          },
        ]}
      />
      <RegistrationOutputActions
        scope={exportMatchesFilters ? "matching" : undefined}
        attendeeUrl={exportsEndpoint}
        sponsorUrl={sponsorExportUrl ?? null}
        onPrint={onPrintAllMatching}
      />
    </>
  );
}
