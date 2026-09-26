import { expect, type Page } from "@playwright/test";
import { e2eAdminEmail } from "../../helpers/e2e-admin";
import { PERSONAS, type PersonaKey } from "../../personas/catalog";
import { signInToPortal } from "./portal-auth";
import { approveMemberThroughReview, readActiveIdentities, uniqueSuffix } from "./membership";

/**
 * The same persona catalog the mounted Worker suites use, provisioned the way
 * a browser must: through the product's own APIs rather than by writing D1.
 *
 * A persona provisioned here therefore has to survive the real join, review,
 * approval, and grant paths. That is slower than seeding rows, and it is the
 * point — it proves the authority is reachable, not merely representable.
 */
export interface BrowserPersona {
  key: PersonaKey;
  email: string;
  userId: string;
  memberships: Array<{ memberId: string; organizationName: string | null }>;
}

/**
 * Provisions a persona. The caller must already hold a staff session capable
 * of approving membership and granting permissions, because that is who
 * performs these actions in the product.
 */
export async function provisionPersona(
  page: Page,
  key: PersonaKey,
  options: { staffScope?: Parameters<typeof e2eAdminEmail>[0] } = {},
): Promise<BrowserPersona> {
  const definition = PERSONAS[key];
  if (key === "anonymous") {
    return { key, email: "", userId: "", memberships: [] };
  }

  const suffix = uniqueSuffix();
  const email = `${key.toLowerCase()}-${suffix}@${key.toLowerCase()}-${suffix}.test`;

  const staffEmail = e2eAdminEmail(options.staffScope ?? "portal-personas-provisioning");
  await signInToPortal(page, staffEmail);

  // A grant needs somebody to hold it, and the product has no path that
  // creates a staff-only user: every non-seeded identity comes into being by
  // being approved as a member. So a grant-only persona is backed by a real
  // person here, which is a deliberate difference from the mounted suites,
  // where the same persona is seeded with no membership at all to prove
  // staff identities cannot reach member-only data.
  const category = definition.membershipCategory ?? (definition.grants.length > 0 ? "A" : null);

  let userId = "";
  if (category) {
    const approved = await approveMemberThroughReview(page, {
      email,
      name: `${definition.description} ${suffix}`,
      category,
      organizationName: `${definition.description} Org ${suffix}`,
    });
    userId = approved.userId;

    // A second represented organization is added the way a real one is: by
    // that organization naming this person as one of its representatives.
    for (let index = 1; index < definition.organizationCount; index += 1) {
      const created = await page.evaluate(
        async ({ organizationName, email, category }) => {
          const response = await fetch("/api/v1/organizations", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
              name: organizationName,
              membershipCategory: category,
              memberSince: "2026-01-15",
              identities: [{ name: "Persona Representative", email, jobTitle: "Delegate" }],
              activationReason: "E2E persona setup",
            }),
          });
          return { status: response.status, body: await response.json() };
        },
        {
          organizationName: `${definition.description} Org ${index + 1} ${suffix}`,
          email,
          category,
        },
      );
      expect(created.status, JSON.stringify(created.body)).toBe(201);
    }
  }

  for (const permission of definition.grants) {
    if (!userId) throw new Error(`Persona ${key} needs a user before it can hold ${permission}`);
    const granted = await page.evaluate(
      async ({ userId, permission }) => {
        const response = await fetch("/api/v1/permissions/grants", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ userId, permission }),
        });
        return { status: response.status, body: await response.json() };
      },
      { userId, permission },
    );
    expect(granted.status, JSON.stringify(granted.body)).toBe(201);
  }

  return { key, email, userId, memberships: [] };
}

/** Provisions a persona and then signs in as them, leaving no staff session. */
export async function signInAsPersona(
  page: Page,
  key: PersonaKey,
  options: { staffScope?: Parameters<typeof e2eAdminEmail>[0] } = {},
): Promise<BrowserPersona> {
  const persona = await provisionPersona(page, key, options);
  await page.context().clearCookies();
  if (key === "anonymous") return persona;
  await signInToPortal(page, persona.email);
  return { ...persona, memberships: await readActiveIdentities(page) };
}
