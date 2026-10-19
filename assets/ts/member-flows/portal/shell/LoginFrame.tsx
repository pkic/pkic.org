/**
 * The sign-in screen's frame: the brand panel beside one narrow card.
 *
 * Signing in and choosing which identity to continue as are two steps of the
 * same arrival, so both speak from this card rather than one of them borrowing
 * a portal page before the portal has been entered.
 */
import type { ComponentChildren } from "preact";
import type { PortalLoginCopy } from "../../../../shared/schemas/portal-login-copy";
import { LoginBackdrop } from "./LoginBackdrop";
import "./Login.css";

export function LoginFrame({
  label,
  title,
  lede,
  busy = false,
  copy,
  foot,
  after,
  children,
}: {
  /** Accessible name of the card's region. */
  label: string;
  title: string;
  lede: ComponentChildren;
  busy?: boolean;
  copy?: PortalLoginCopy;
  /** The card's closing band. */
  foot?: ComponentChildren;
  /** Fine print under the card. */
  after?: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    <div class="pk pk-login">
      <LoginBackdrop copy={copy} />
      <section class="pk-login__panel" aria-label={label} aria-busy={busy}>
        <div class="pk-login__card-wrap">
          <div class="pk-login__card">
            <div class="pk-login__card-rule" aria-hidden="true" />
            <div class="pk-login__card-body pk-stack">
              <div class="pk-stack pk-stack--tight">
                <h1 class="pk-login__title">{title}</h1>
                <p class="pk-small pk-muted">{lede}</p>
              </div>
              {children}
            </div>
            {foot && <div class="pk-login__card-foot">{foot}</div>}
          </div>
          {after}
        </div>
      </section>
    </div>
  );
}
