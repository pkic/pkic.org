/**
 * @covers presentation.13.1
 */
import { expect, test, type Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

/**
 * The dark theme has to reach the page, not only the components.
 *
 * The site spent its whole life on a white ground that the browser supplied by
 * default, so a surface could hard-code `#fff` and nobody would see it. The
 * moment a reader can choose the dark theme, each of those becomes a light
 * island carrying near-white text — unreadable, and invisible to every check
 * that reads source rather than pixels. Seven surfaces were in that state when
 * the toggle went in.
 *
 * So this reads what the browser actually computed, on the pages a visitor
 * lands on first.
 */

const PAGES = ["/", "/about/", "/members/", "/blog/", "/sponsors/", "/events/"];

/** Relative luminance, or null when the colour is transparent. */
const LUMINANCE = `(value) => {
  const parts = value.match(/[\\d.]+/g);
  if (!parts) return null;
  // A translucent background composites onto whatever is behind it, so it
  // cannot be judged on its own — a white card at 6% opacity is how a panel
  // sits on the dark hero, and it is correct there.
  if (parts[3] !== undefined && Number(parts[3]) < 1) return null;
  const [r, g, b] = parts.map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}`;

async function unreadableSurfaces(page: Page): Promise<string[]> {
  return page.evaluate(`(() => {
    const luminance = ${LUMINANCE};
    const found = new Set();
    for (const element of document.querySelectorAll("main *, footer *, #portal-root *")) {
      const box = element.getBoundingClientRect();
      // Something big enough to read text on. A 20px chip that borrows its
      // ground from a parent is not what this is looking for.
      if (box.width < 200 || box.height < 60) continue;
      const styles = getComputedStyle(element);
      const ground = luminance(styles.backgroundColor);
      if (ground === null) continue;
      const ink = luminance(styles.color);
      const lightGroundInDarkTheme = ground > 0.75;
      const inkTooCloseToGround = ink !== null && Math.abs(ground - ink) < 0.25;
      if (lightGroundInDarkTheme || inkTooCloseToGround) {
        found.add(element.tagName.toLowerCase() + "." + String(element.className).slice(0, 40) +
          " background " + styles.backgroundColor + ", text " + styles.color);
      }
    }
    return [...found];
  })()`);
}

test.describe("the dark theme", () => {
  test.use({ colorScheme: "dark" });

  for (const path of PAGES) {
    test(`leaves nothing unreadable on ${path}`, async ({ page }) => {
      await page.addInitScript(() => {
        try {
          localStorage.setItem("pk-theme", "dark");
        } catch {
          // A browser that refuses storage still honours the OS preference.
        }
      });
      await page.goto(path);
      /*
       * Against the token, not a literal color. The page has its own ground
       * beneath raised surfaces; a hardcoded value here would fail when the
       * palette changes. What matters is that the theme reaches `body`.
       */
      const ground = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        const toRgb = (value: string) => {
          const probe = document.createElement("span");
          probe.style.color = value.trim();
          document.body.appendChild(probe);
          const computed = getComputedStyle(probe).color;
          probe.remove();
          return computed;
        };
        return {
          body: getComputedStyle(document.body).backgroundColor,
          surface: toRgb(style.getPropertyValue("--pk-page-surface")),
          light: toRgb("#ffffff"),
        };
      });
      expect(ground.body).toBe(ground.surface);
      // And the dark theme actually took: a white ground means the tokens
      // never flipped, which is the regression this file exists to catch.
      expect(ground.body).not.toBe(ground.light);
      expect(await unreadableSurfaces(page)).toEqual([]);
    });
  }

  test("keeps event content and affiliation marks legible", async ({ page }) => {
    await page.goto("/events/2026/pqc-conference-amsterdam-nl/");

    const reasons = page.getByText("The rules are finalized").locator("xpath=ancestor::section[1]");
    await expect(reasons).toBeVisible();
    const columns = await reasons.evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length,
    );
    expect(columns).toBe(2);

    await page.goto("/events/2026/pqc-conference-amsterdam-nl/register/");
    const warning = page
      .getByText("In-person registration is currently full.")
      .locator("xpath=ancestor::blockquote[1]");
    await expect(warning).toBeVisible();
    const warningSurface = await warning.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(warningSurface).not.toBe("rgb(255, 255, 255)");
    expect(await unreadableSurfaces(page)).toEqual([]);

    await page.goto("/wg/pqc/");
    const logo = page.locator(".person-card-org-logo").first();
    await expect(logo).toBeVisible();
    await expect.poll(() => logo.evaluate((element) => getComputedStyle(element).filter)).toContain("invert(1)");
  });

  test("keeps the member directory, blog sidebar, and About mark readable", async ({ page }) => {
    await page.goto("/wg/pqc/members/");
    const card = page.locator(".member-card:has(.member-card-description):has(.member-card-logo)").first();
    await expect(card).toBeVisible();
    const memberStyles = await card.evaluate((element) => {
      const description = element.querySelector(".member-card-description");
      const logo = element.querySelector(".member-card-logo");
      const probe = document.createElement("span");
      probe.style.color = "var(--pk-ink-muted)";
      element.appendChild(probe);
      const mutedInk = getComputedStyle(probe).color;
      probe.remove();
      return {
        descriptionColor: description && getComputedStyle(description).color,
        mutedInk,
        logoFilter: logo && getComputedStyle(logo).filter,
      };
    });
    expect(memberStyles.descriptionColor).toBe(memberStyles.mutedInk);
    expect(memberStyles.logoFilter).toContain("invert(1)");

    await page.goto("/about/");
    const aboutLogo = page.getByRole("img", { name: "Logo of the PKI Consortium" });
    await expect(aboutLogo).toBeVisible();
    expect(await aboutLogo.evaluate((element) => getComputedStyle(element).filter)).toContain("invert(1)");

    await page.goto("/authors/");
    const author = page.locator(".blog-taxonomy-index a").first();
    await expect(author).toBeVisible();
    expect(await author.evaluate((element) => getComputedStyle(element).color)).toBe(
      await page.locator("body").evaluate((element) => getComputedStyle(element).color),
    );

    await page.goto(
      "/2026/06/14/defining-quantum-ready-for-the-supply-chain-introducing-the-pqc-maturity-model-pqcmm/",
    );
    const byline = page.locator(".blog-author-name").first();
    await expect(byline).toBeVisible();
    expect(await byline.evaluate((element) => getComputedStyle(element).color)).toBe(
      await page.locator("body").evaluate((element) => getComputedStyle(element).color),
    );
    expect(await unreadableSurfaces(page)).toEqual([]);
  });

  test("reaches the portal's own chrome, not only the components in it", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("pk-theme", "dark");
      } catch {
        // A browser that refuses storage still honours the OS preference.
      }
    });
    await signInToPortal(page, e2eAdminEmail("portal-dark-theme"));

    // The sidebar and the page around it were three fixed colours, so the
    // portal stayed light while the tables and inputs inside it went dark.
    await expect(page.locator("#portal-root")).toBeVisible();
    expect(await unreadableSurfaces(page)).toEqual([]);

    // The issue was reported against data-heavy portal screens. Exercise an
    // actual table and a settings form instead of treating the empty shell as
    // representative of cards, controls and rows.
    for (const route of ["/portal/#/users", "/portal/#/settings/application-workflow"]) {
      await page.goto(route);
      await expect(page.locator(".pk-table, .pk-panel").first()).toBeVisible();
      expect(await unreadableSurfaces(page), route).toEqual([]);
    }
  });

  test("remembers the reader's choice and hands it back", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: /^Theme:/ });
    await expect(toggle).toBeVisible();

    // The OS preference is dark here, and the reader has chosen nothing yet.
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);

    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // Back to following the system, which is the state the attribute cannot
    // express and a two-way switch would have taken away.
    await toggle.click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
    await page.reload();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  });
});

test.describe("the light theme", () => {
  test.use({ colorScheme: "light" });

  test("preserves color artwork in the sponsor wall and on affiliation hover", async ({ page }) => {
    await page.goto("/");
    await expect
      .poll(() =>
        page.locator(".members img").evaluateAll((images) => {
          const sponsor = images.find((image) => image.classList.contains("member-logo-sponsor"));
          return sponsor ? getComputedStyle(sponsor).filter : null;
        }),
      )
      .toBe("none");

    // Public leadership data can be empty locally, so exercise its real CSS
    // with a minimal card while retaining the same page and theme stylesheet.
    await page.evaluate(() => {
      const card = document.createElement("div");
      card.className = "person-card";
      card.innerHTML = '<img class="person-card-org-logo" src="/img/logo-black.svg" alt="Affiliation">';
      document.body.appendChild(card);
    });
    const logo = page.locator(".person-card-org-logo");
    expect(await logo.evaluate((element) => getComputedStyle(element).filter)).toContain("grayscale(1)");
    await page.locator(".person-card").hover();
    await expect.poll(() => logo.evaluate((element) => getComputedStyle(element).filter)).toBe("none");
  });
});
