import {
  PORTAL_LOGIN_COPY_ID,
  portalLoginCopySchema,
  type PortalLoginCopy,
} from "../../../../shared/schemas/portal-login-copy";

/**
 * What the brand panel says, as Hugo wrote it.
 *
 * Absent or malformed copy is not an error worth showing a reader who came
 * here to sign in: the panel falls back to its own headline and drops the
 * figures entirely. Figures are never invented here — a count of member
 * organizations that the site does not state is a claim this screen has no
 * business making.
 */
function readCopy(): PortalLoginCopy {
  if (typeof document === "undefined") return {};
  const source = document.getElementById(PORTAL_LOGIN_COPY_ID)?.textContent;
  if (!source) return {};
  try {
    const parsed = portalLoginCopySchema.safeParse(JSON.parse(source));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/**
 * The panel beside the sign-in card.
 *
 * Decorative rather than informative: it is marked `aria-hidden` only for its
 * gradient and stripe, which the stylesheet draws, while the words stay in the
 * accessibility tree because they say what this portal is for.
 */
export function LoginBackdrop() {
  const copy = readCopy();
  const facts = copy.facts ?? [];

  return (
    <aside class="pk-login__backdrop">
      <div class="pk-login__lede">
        <p class="pk-login__kicker">{copy.kicker ?? "Member portal"}</p>
        <h2 class="pk-login__headline">{copy.headline ?? "The work behind trusted digital assets happens here."}</h2>
        {copy.blurb && <p class="pk-login__blurb">{copy.blurb}</p>}
      </div>
      {facts.length > 0 && (
        <dl class="pk-login__facts">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt class="pk-login__fact-value">{fact.value}</dt>
              <dd class="pk-login__fact-label">{fact.label}</dd>
            </div>
          ))}
        </dl>
      )}
    </aside>
  );
}
