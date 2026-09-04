import { Alert } from "pkic-org-events-backend";

export function Tones() {
  return (
    <div class="pk pk-stack pk-stack--tight">
      <Alert tone="ok" title="Charter published">
        The Post-Quantum Cryptography charter is now visible to all members.
      </Alert>
      <Alert tone="info" title="Review window open">
        Working group leads can comment until 30 June.
      </Alert>
      <Alert tone="warn" title="Membership expires soon">
        Three organizations have agreements lapsing within 30 days.
      </Alert>
      <Alert tone="danger" title="Signature verification failed">
        The uploaded agreement could not be verified against the issuing CA.
      </Alert>
    </div>
  );
}

export function BodyOnly() {
  return (
    <div class="pk">
      <Alert tone="info">Members are listed in the order they joined the group.</Alert>
    </div>
  );
}
