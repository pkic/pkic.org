import type { ComponentChildren } from "preact";
import type { ScreenId } from "../../shared/schemas/event-screens";
import { LiveOverlayFrame } from "../live-session/LiveOverlayFrame";
import type { ScreenMarker as Marker } from "./screen-display";
import { ScreenMarker } from "./ScreenMarker";
import "./ScreenStatus.css";

/**
 * A screen's own page while it shows no output: the consortium's mark, not an
 * event's, since an unpaired or unassigned screen belongs to no event yet.
 */
function ScreenStatusFrame({
  view,
  marker = null,
  children,
}: {
  view: string;
  marker?: Marker;
  children: ComponentChildren;
}) {
  return (
    <LiveOverlayFrame view={view}>
      <div class="pk-screen-status">
        <header class="pk-screen-status__brand">
          <img src="/img/logo.svg" width="1256" height="324" alt="PKI Consortium" />
        </header>
        <div class="pk-screen-status__main">{children}</div>
      </div>
      <ScreenMarker marker={marker} />
    </LiveOverlayFrame>
  );
}

/** Shown in two groups of four, as it is read aloud and typed. */
function PairingCode({ code }: { code: string }) {
  return (
    <span class="pk-screen-status__code">
      <span>{code.slice(0, 4)}</span>
      <span>{code.slice(4)}</span>
    </span>
  );
}

/**
 * An unpaired screen: the code staff enter in the studio to approve it, the
 * screen ID they enter with it, and how long the code stays valid.
 */
export function ScreenPairing({
  screenId,
  pairing,
}: {
  screenId: ScreenId;
  /** The current code and the time left on it, as text; null until the screen has one. */
  pairing: { code: string; expiresIn: string } | null;
}) {
  return (
    <ScreenStatusFrame view="screen-pairing">
      <dl class="pk-screen-status__pairing">
        <div class="pk-screen-status__entry" data-lead>
          <dt>Pairing code</dt>
          <dd>{pairing ? <PairingCode code={pairing.code} /> : null}</dd>
        </div>
        <div class="pk-screen-status__entry">
          <dt>Screen ID</dt>
          <dd class="pk-screen-status__id">{screenId}</dd>
        </div>
      </dl>
      <p class="pk-screen-status__line">
        <span>In the studio: Screens → Pair screen</span>
        {pairing ? <span class="pk-screen-status__muted">Code expires in {pairing.expiresIn}</span> : null}
      </p>
    </ScreenStatusFrame>
  );
}

/**
 * A paired screen with nothing to show: where it stands, so staff can find it
 * in the studio, and why it shows nothing.
 */
export function ScreenWaiting({
  screenId,
  name,
  status = "Not assigned yet",
  marker = null,
}: {
  screenId: ScreenId;
  name: string;
  status?: string;
  marker?: Marker;
}) {
  return (
    <ScreenStatusFrame view="screen-waiting" marker={marker}>
      <div class="pk-screen-status__waiting">
        <p class="pk-screen-status__name">{name}</p>
        <p class="pk-screen-status__muted">{status}</p>
      </div>
      <p class="pk-screen-status__line pk-screen-status__muted">
        <span>
          Screen ID <span class="pk-screen-status__mono">{screenId}</span>
        </span>
      </p>
    </ScreenStatusFrame>
  );
}
