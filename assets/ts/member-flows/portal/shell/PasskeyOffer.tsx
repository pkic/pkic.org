/**
 * The offer to create a passkey, right after a sign-in that used an emailed
 * link: the moment the person has just proven the account is theirs on this
 * device.
 *
 * It asks after every such sign-in until a passkey is made or the person says
 * not to ask on this device. That choice is the device's, kept in its own
 * storage: a shared or borrowed computer is exactly where someone declines
 * for good, and their own laptop should still be asked.
 */
import { useState } from "preact/hooks";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";

import { usePasskeyEnrollment } from "../../../components/passkey-enrollment";
import { Alert } from "../../../ui/Alert";
import { Button } from "../../../ui/Button";
import { Checkbox } from "../../../ui/Checkbox";
import { LoginFrame } from "./LoginFrame";

const DECLINED_ON_DEVICE = "pk-passkey-offer-declined";

function declinedOnThisDevice(): boolean {
  try {
    return window.localStorage.getItem(DECLINED_ON_DEVICE) === "1";
  } catch {
    return false;
  }
}

function declineOnThisDevice(): void {
  try {
    window.localStorage.setItem(DECLINED_ON_DEVICE, "1");
  } catch {
    // Without storage the offer simply returns at the next emailed sign-in.
  }
}

/** Whether to offer a passkey now: after an emailed sign-in, on a device that can hold one and was not excused. */
export function passkeyOfferDue(signedInWithLink: boolean): boolean {
  return signedInWithLink && browserSupportsWebAuthn() && !declinedOnThisDevice();
}

export function PasskeyOffer({ onDone }: { onDone: () => void }) {
  const { enroll, enrolling } = usePasskeyEnrollment();
  const [error, setError] = useState<string | null>(null);
  const [stopAsking, setStopAsking] = useState(false);

  async function create(): Promise<void> {
    setError(null);
    const failure = await enroll();
    if (failure) setError(failure);
    else onDone();
  }

  return (
    <LoginFrame
      label="You're signed in"
      title="You're signed in"
      lede="Next time, skip the email: create a passkey and sign in with your fingerprint, face or device PIN. Only create one on a device that is yours."
      busy={enrolling}
    >
      <fieldset class="pk-login__controls pk-stack" disabled={enrolling}>
        <Button variant="primary" loading={enrolling} onClick={() => void create()}>
          {enrolling ? "Creating…" : "Create a passkey"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            if (stopAsking) declineOnThisDevice();
            onDone();
          }}
        >
          Continue without a passkey
        </Button>
        <Checkbox
          label="Don't ask again on this device"
          checked={stopAsking}
          onChange={(event) => setStopAsking(event.currentTarget.checked)}
        />
      </fieldset>
      {error && <Alert tone="danger">{error}</Alert>}
    </LoginFrame>
  );
}
