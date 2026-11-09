import { render, type ComponentProps } from "preact";
import { act } from "preact/test-utils";
import { EventProposalIdentityStep } from "../../../assets/ts/components/EventProposalIdentityStep";

/** Confirm a proposed organization through the visible chooser. */
export async function chooseProposalOrganization(host: HTMLElement, organizationId: string) {
  const choice = host.querySelector("select")!;
  if (choice.value) throw new Error("The organization must not be preselected");
  await act(() => {
    choice.value = organizationId;
    choice.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** Mount the actual identity step with synthetic event defaults. */
export async function mountProposalIdentityStep(
  props: Pick<ComponentProps<typeof EventProposalIdentityStep>, "enabled" | "entryContext" | "onChange">,
) {
  const host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      <EventProposalIdentityStep
        {...props}
        eventSlug="pqc-2026"
        consents={() => [{ termKey: "speaker-agreement", version: "1" }]}
      />,
      host,
    ),
  );
  return host;
}
