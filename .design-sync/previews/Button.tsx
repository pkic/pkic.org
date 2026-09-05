import { Button } from "pkic-org-events-backend";

export function Variants() {
  return (
    <div class="pk pk-cluster">
      <Button variant="primary">Publish charter</Button>
      <Button variant="secondary">Save draft</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="danger">Remove member</Button>
      <Button variant="danger-quiet">Withdraw</Button>
      <Button variant="link">View history</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div class="pk pk-cluster">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  );
}

export function States() {
  return (
    <div class="pk pk-cluster">
      <Button disabled>Disabled</Button>
      <Button loading>Submitting</Button>
      <Button icon aria-label="Settings">
        ⚙
      </Button>
    </div>
  );
}
