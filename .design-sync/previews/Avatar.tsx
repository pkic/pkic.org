import { Avatar, Panel, PanelBody, PanelHeader } from "pkic-org-events-backend";

const portrait =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' fill='%23256d4a'/%3E%3Ccircle cx='32' cy='24' r='11' fill='%23cfe6da'/%3E%3Cpath d='M8 64c0-13 11-21 24-21s24 8 24 21z' fill='%23cfe6da'/%3E%3C/svg%3E";

export function Sizes() {
  return (
    <div class="pk pk-cluster">
      <span class="pk-cluster">
        <Avatar name="Alice Chen" size="sm" />
        <span class="pk-muted pk-small">sm</span>
      </span>
      <span class="pk-cluster">
        <Avatar name="Alice Chen" />
        <span class="pk-muted pk-small">md (default)</span>
      </span>
      <span class="pk-cluster">
        <Avatar name="Alice Chen" size="lg" />
        <span class="pk-muted pk-small">lg</span>
      </span>
    </div>
  );
}

export function InitialsAndImage() {
  return (
    <div class="pk pk-cluster">
      <Avatar name="Priya Raman" />
      <Avatar name="Bo Halvorsen" />
      <Avatar name="Marc Dubois" />
      <Avatar name="Yuki" />
      <Avatar name="Alice Chen" src={portrait} />
      <Avatar name="Alice Chen" src={portrait} size="lg" />
    </div>
  );
}

export function InRoster() {
  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="Post-Quantum Cryptography leads" />
        <PanelBody>
          <div class="pk-stack pk-stack--tight">
            <div class="pk-cluster">
              <Avatar name="Alice Chen" src={portrait} />
              <span>
                <span class="pk-strong">Alice Chen</span>
                <span class="pk-muted pk-small"> &middot; Chair, SecureCA Inc</span>
              </span>
            </div>
            <div class="pk-cluster">
              <Avatar name="Bo Halvorsen" />
              <span>
                <span class="pk-strong">Bo Halvorsen</span>
                <span class="pk-muted pk-small"> &middot; Vice chair, Nordic Trust Services AS</span>
              </span>
            </div>
            <div class="pk-cluster">
              <Avatar name="Priya Raman" size="sm" />
              <span class="pk-small">Priya Raman &middot; Editor</span>
            </div>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}

/**
 * A portrait carrying a standing. `neutral` is the past tense of `accent`:
 * a former chair reads as former without the label saying so.
 */
export function Standing() {
  return (
    <div class="pk pk-cluster" style={{ "--pk-gap": "var(--pk-6)" }}>
      <Avatar name="Paul van Brouwershaven" size="xl" status={{ label: "Board member" }} />
      <Avatar name="Amara Osei" size="xl" status={{ label: "Chair" }} />
      <Avatar name="Lena Fischer" size="xl" status={{ label: "Past chair", tone: "neutral" }} />
    </div>
  );
}
