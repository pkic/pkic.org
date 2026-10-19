import { ErrorAlert } from "../../components/ErrorAlert";
import { Spinner } from "../../components/Spinner";
import { useEffect, useRef, useState } from "preact/hooks";
import { SupportBanner } from "../../site/SupportBanner";
import { DonationWidget, type DonationWidgetOptions } from "../../site/DonationWidget";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import "./DonationPrompt.css";

const messages = [
  {
    heading: "Help keep the doors open",
    body: "Our events are free because people like you give. A donation of any size helps welcome the next attendee.",
  },
  {
    heading: "Make room for the next attendee",
    body: "Free events bring more people into the conversation. Your voluntary donation helps keep them open to everyone.",
  },
  {
    heading: "Support the work behind trust",
    body: "Sponsors and voluntary donations make our free events possible. Help us keep the conversation going.",
  },
];

function DonationDialog({ options, onClose }: { options: DonationWidgetOptions; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    setReady(false);
    setError(null);
    void import("./form")
      .then(({ initDonationForm }) => {
        if (cancelled) return;
        const form = root.current?.querySelector<HTMLElement>("[data-donation-form]");
        if (!form) throw new Error("Donation form is unavailable");
        dispose = initDonationForm(form);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setError("The donation form could not load. Please try again.");
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [attempt]);
  return (
    <Dialog
      open
      viewer
      title="Support the PKI Consortium"
      closeLabel="Close donation"
      confirmLabel="Close"
      onConfirm={onClose}
      onCancel={onClose}
    >
      <div class="pk-stack" ref={root}>
        <p>A donation of any size helps keep our events open to everyone. We’ll email you a receipt.</p>
        {!ready && !error && <Spinner />}
        {error && (
          <>
            <ErrorAlert error={error} />
            <Button onClick={() => setAttempt((value) => value + 1)}>Try again</Button>
          </>
        )}
        <div inert={!ready}>
          <DonationWidget opts={{ ...options, hideIdentityFields: Boolean(options.name && options.email) }} />
        </div>
        <p class="pk-small pk-muted">
          Donations are voluntary and are not tickets or registration fees. Contributions are not deductible as
          charitable contributions for US federal income tax purposes.
        </p>
      </div>
    </Dialog>
  );
}

/** A stable per-visit variation; the payment form and amounts never vary. */
export function DonationPrompt({ options = {} }: { options?: DonationWidgetOptions }) {
  const [message] = useState(() => Math.floor(Math.random() * messages.length));
  const [open, setOpen] = useState(false);
  const copy = messages[message]!;
  return (
    <div class="pk-donation-prompt" data-variation={message}>
      <SupportBanner
        variant="compact"
        reveal={false}
        heading={copy.heading}
        body={copy.body}
        actions={
          <Button variant="primary" onClick={() => setOpen(true)}>
            Donate now
          </Button>
        }
      />
      {open && <DonationDialog options={options} onClose={() => setOpen(false)} />}
    </div>
  );
}
