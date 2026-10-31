import { isApplicationTerminalStage } from "../../shared/schemas/member-applications";
import type { MembershipWorkflowProgress as Progress } from "../../shared/schemas/membership-workflows";
import { formatCurrencyAmount } from "../../shared/format-currency";
import { formatDateTime } from "../shared/ui";
import { Badge } from "./Badge";
import { ButtonLink } from "../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../ui/Panel";

import "./MembershipWorkflowProgress.css";
import { SectionHeading } from "../ui/SectionHeading";

/** A step's state is expected progress, so it reads as plain text; the numbered marker carries its color. */
const STEP_STATE_LABEL: Record<Progress["steps"][number]["state"], string> = {
  waiting: "Not started",
  active: "In progress",
  complete: "Complete",
};

export function MembershipWorkflowProgress({ progress }: { progress: Progress }) {
  return (
    <Panel class="membership-progress" aria-label="Membership requirements">
      <PanelHeader title={progress.name} headingLevel={3}>
        <Badge status={progress.lifecycle} />
      </PanelHeader>
      <PanelBody>
        <p class="membership-progress__version">Application process · version {progress.version}</p>
        <ol class="membership-progress__steps">
          {progress.steps.map((step) => (
            <li class={`membership-progress__step membership-progress__step--${step.state}`} key={step.stepId}>
              <div class="membership-progress__marker" aria-hidden="true">
                {step.position + 1}
              </div>
              <div class="membership-progress__content pk-stack pk-stack--snug">
                <div class="membership-progress__heading">
                  <SectionHeading level={4}>{step.label}</SectionHeading>
                  <span class="membership-progress__state pk-small">{STEP_STATE_LABEL[step.state]}</span>
                </div>
                <p>{step.instructions}</p>
                {step.review && (
                  <p class="pk-small">
                    Who can respond: {step.review.who}.{step.review.where && <> Notice goes to {step.review.where}.</>}
                  </p>
                )}
                <div class="membership-progress__dates pk-small">
                  {step.openedAt && <span>Opened {formatDateTime(step.openedAt)}</span>}
                  {step.deadlineAt && <span>Due {formatDateTime(step.deadlineAt)}</span>}
                  {step.completedAt && <span>Completed {formatDateTime(step.completedAt)}</span>}
                </div>
                {step.blocker && <p>{step.blocker}</p>}
                {step.payment && (
                  <div class="membership-progress__payment pk-stack pk-stack--snug">
                    <p>
                      Required fee: <strong>{formatCurrencyAmount(step.payment.amount, step.payment.currency)}</strong>
                    </p>
                    {step.state === "waiting" && (
                      <p>Payment will be available after the previous requirements are complete.</p>
                    )}
                    {step.payment.handlingRequired && (
                      <p>
                        The payment needs review by the membership team. Your application will not be reopened
                        automatically.
                      </p>
                    )}
                    {step.payment.checkoutUrl && (
                      <div>
                        <ButtonLink href={step.payment.checkoutUrl} variant="primary">
                          Pay membership fee
                        </ButtonLink>
                      </div>
                    )}
                    {step.payment.status === "expired" && (
                      <p>The payment deadline has passed. Contact the membership team before making a payment.</p>
                    )}
                    {!isApplicationTerminalStage(progress.lifecycle) &&
                      progress.lifecycle !== "on_hold" &&
                      step.state === "active" &&
                      step.payment.status === "pending" &&
                      !step.payment.handlingRequired &&
                      !step.payment.checkoutUrl && (
                        <p>Your payment link is being prepared. Refresh this page shortly.</p>
                      )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </PanelBody>
    </Panel>
  );
}
