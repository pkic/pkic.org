import { VerifiedValue } from "../VerifiedValue";
import type { PreviewSection } from "./PreviewShell";

export const verifiedValueSection: PreviewSection = {
  id: "verified-value",
  title: "Verified value",
  note: "Confirmation stays beside the value; pending explanations use the shared tooltip on hover, focus, and tap.",
  render: () => (
    <div class="pk-preview__shelf">
      <VerifiedValue verified>ada@example.test</VerifiedValue>
      <span data-gallery-open="focus">
        <VerifiedValue verified={false} pendingExplanation="Check your inbox to confirm this email address.">
          pending@example.test
        </VerifiedValue>
      </span>
    </div>
  ),
};
