import { isApplicationTerminalStage } from "../../shared/schemas/member-applications";
import type { MembershipWorkflowProgress as Progress } from "../../shared/schemas/membership-workflows";
import { currencyInfo } from "../../shared/constants/currencies";
import { formatDateTime } from "../shared/ui";
import { Badge } from "./Badge";
import { ButtonLink } from "../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../ui/Panel";

export function membershipFeeLabel(amount: number, currency: string): string {
  const info = currencyInfo(currency);
  return new Intl.NumberFormat(undefined, { style: "currency", currency: info.code.toUpperCase() }).format(
    amount / (info.zeroDecimal ? 1 : 100),
  );
}
export function MembershipWorkflowProgress({ progress }: { progress: Progress }) {
  return (
    <div class="pk-stack" aria-label="Membership requirements">
      <p>
        {progress.name} · version {progress.version}. <Badge status={progress.lifecycle} />
      </p>
      {progress.steps.map((step) => (
        <Panel key={step.stepId}>
          <PanelHeader title={`${step.position + 1}. ${step.label}`} />
          <PanelBody class="pk-stack pk-stack--snug">
            <div>
              <Badge status={step.state} />
            </div>
            <p>{step.instructions}</p>
            {step.review && (
              <p>
                Who can respond: {step.review.who}.{step.review.where && <> Notice goes to {step.review.where}.</>}
              </p>
            )}
            {step.openedAt && <p>Opened: {formatDateTime(step.openedAt)}</p>}
            {step.deadlineAt && <p>Deadline: {formatDateTime(step.deadlineAt)}</p>}
            {step.completedAt && <p>Completed {formatDateTime(step.completedAt)}</p>}
            {step.blocker && <p>{step.blocker}</p>}
            {step.payment && (
              <>
                <p>Required fee: {membershipFeeLabel(step.payment.amount, step.payment.currency)}.</p>
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
                  !step.payment.checkoutUrl && <p>Your payment link is being prepared. Refresh this page shortly.</p>}
              </>
            )}
          </PanelBody>
        </Panel>
      ))}
    </div>
  );
}
