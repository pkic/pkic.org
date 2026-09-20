import { useState } from "preact/hooks";
import { eventRegistrationPromotionsResponseSchema } from "../../../shared/schemas/event-registrations";
import { postJson } from "../../shared/api-client";
import { Button } from "../../ui/Button";

export function RegistrationRosterActions({
  promotionsEndpoint,
  exportsEndpoint,
  onPromoted,
  notify,
}: {
  promotionsEndpoint: string;
  exportsEndpoint: string;
  onPromoted: () => void | Promise<void>;
  notify: (message: string, kind: "success" | "error") => void;
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
      <Button variant="secondary" size="sm" disabled={promoting} onClick={() => void runWaitlistPromotions()}>
        {promoting ? "Running promotions…" : "Run waitlist promotions"}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => (window.location.href = exportsEndpoint)}>
        Download CSV
      </Button>
    </>
  );
}
