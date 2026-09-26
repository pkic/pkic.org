import { useEffect, useState } from "preact/hooks";
import { publicMembersListResponseSchema } from "../../../../shared/schemas/members-directory";
import {
  PORTAL_LOGIN_COPY_ID,
  portalLoginCopySchema,
  type PortalLoginCopy,
  type PortalLoginFact,
} from "../../../../shared/schemas/portal-login-copy";
import { getJson } from "../../../shared/api-client";

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
 * The size of one slice of the members roll, counted rather than authored.
 *
 * The roll is a paginated public list, so its size is `page.total` for a page
 * of one — the same thing the navbar's member counts read, from the same
 * edge-cached endpoint. A figure that cannot be counted keeps the placeholder
 * the site wrote: a screen that invents a membership figure is worse than one
 * that shows a dash.
 */
function useMemberCounts(facts: readonly PortalLoginFact[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const slices = [...new Set(facts.map((fact) => fact.memberCount).filter((slice) => slice != null))].join(",");

  useEffect(() => {
    if (!slices) return;
    let cancelled = false;
    void Promise.all(
      slices.split(",").map(async (slice) => {
        const page = await getJson(
          `/api/v1/members?group=${encodeURIComponent(slice)}&limit=1`,
          publicMembersListResponseSchema,
        );
        return [slice, page.page.total] as const;
      }),
    ).then(
      (resolved) => {
        if (!cancelled) setCounts(Object.fromEntries(resolved));
      },
      () => {
        // The placeholder stands; a sign-in screen does not need this figure.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [slices]);

  return counts;
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
  const counts = useMemberCounts(facts);

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
              <dt class="pk-login__fact-value" aria-live={fact.memberCount ? "polite" : undefined}>
                {fact.memberCount != null && counts[fact.memberCount] !== undefined
                  ? String(counts[fact.memberCount])
                  : fact.value}
              </dt>
              <dd class="pk-login__fact-label">{fact.label}</dd>
            </div>
          ))}
        </dl>
      )}
    </aside>
  );
}
