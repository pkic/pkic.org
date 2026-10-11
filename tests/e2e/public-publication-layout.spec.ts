/** Opt-in geometry checks against synthetic build-time publication data. @covers presentation.13.7 */
import { expect, test } from "@playwright/test";

test("sponsor tier frames scale small artwork and stay contained across screen sizes", async ({ page }) => {
  await page.route("**/img/synthetic-tier-logo.svg?*", (route) => {
    const shape = new URL(route.request().url()).searchParams.get("shape");
    const [width, height] = shape === "wide" ? [40, 10] : shape === "tall" ? [10, 40] : [10, 10];
    return route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#198754"/></svg>`,
    });
  });
  for (const theme of ["light", "dark"]) {
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/sponsors/");
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      const diamond = page.locator('.sponsors-tier[data-weight="6"]');
      const platinum = page.locator('.sponsors-tier[data-weight="4"]');
      const frame = diamond.getByRole("link");
      const logo = diamond.getByRole("img");
      await expect(logo).toBeVisible();
      expect(await frame.evaluate((element) => parseFloat(getComputedStyle(element).height))).toBe(120);
      if (width <= 390) expect((await frame.boundingBox())!.width).toBeGreaterThan(width * 0.65);
      expect((await frame.boundingBox())!.height).toBeGreaterThan(
        (await platinum.getByRole("link").boundingBox())!.height,
      );
      await page.screenshot({ path: test.info().outputPath(`sponsors-page-${theme}-${width}.png`), fullPage: true });
      for (const shape of ["wide", "square", "tall"]) {
        await logo.evaluate((image, shape) => {
          image
            .closest("picture")
            ?.querySelectorAll("source")
            .forEach((source) => source.remove());
          image.removeAttribute("srcset");
          image.setAttribute("src", `/img/synthetic-tier-logo.svg?shape=${shape}`);
        }, shape);
        await expect
          .poll(() => logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0))
          .toBe(true);
        const imageBox = (await logo.boundingBox())!;
        const frameBox = (await frame.boundingBox())!;
        // Even tiny source artwork fills its tier frame; contain preserves the drawing's aspect ratio.
        const content = await frame.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            width: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
            height: element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
          };
        });
        expect(imageBox.width).toBeCloseTo(content.width, 0);
        expect(imageBox.height).toBeCloseTo(content.height, 0);
        expect(imageBox.x).toBeGreaterThanOrEqual(frameBox.x);
        expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(frameBox.x + frameBox.width + 1);
        expect(await logo.evaluate((image) => getComputedStyle(image).objectFit)).toBe("contain");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await diamond.screenshot({ path: test.info().outputPath(`diamond-sponsor-${theme}-${width}.png`) });
    }
  }
});

test("member profile logos keep a balanced frame across wide, square, and tall artwork", async ({ page }) => {
  await page.goto("/members/example-corp/");
  const logo = page.locator(".member-profile-logo");
  const frame = page.locator(".member-profile-logo-wrap");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => localStorage.setItem("pk-theme", theme), theme);
    await page.reload();
    await expect(logo).toHaveAttribute("data-logo-ink", "light");
    expect(await logo.evaluate((image) => getComputedStyle(image).filter)).toBe("none");
    const backing = await frame.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(backing).not.toBe("rgba(0, 0, 0, 0)");
    await frame.screenshot({ path: test.info().outputPath(`member-white-logo-${theme}.png`) });
  }
  await page.route("**/img/synthetic-balance.svg*", (route) => {
    const shape = new URL(route.request().url()).searchParams.get("shape");
    const [width, height] = shape === "wide" ? [1200, 100] : shape === "tall" ? [100, 1200] : [200, 200];
    return route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#198754"/></svg>`,
    });
  });
  for (const shape of ["wide", "square", "tall"]) {
    await logo.evaluate((image, shape) => {
      image
        .closest("picture")
        ?.querySelectorAll("source")
        .forEach((source) => source.remove());
      image.removeAttribute("srcset");
      image.setAttribute("src", `/img/synthetic-balance.svg?shape=${shape}`);
    }, shape);
    await expect
      .poll(() => logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0))
      .toBe(true);
    const bounds = await logo.boundingBox();
    const container = await frame.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(320);
    expect(bounds!.height).toBeLessThanOrEqual(112);
    expect(bounds!.width).toBeLessThanOrEqual(container!.width);
    expect(await logo.evaluate((image) => getComputedStyle(image).objectFit)).toBe("contain");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    await frame.screenshot({ path: test.info().outputPath(`member-logo-${shape}.png`) });
  }
});

test("working-group introduction, leaders and social icons share the full row", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/wg/tcwg/");
  const intro = page.locator(".wg-intro-layout");
  await expect(intro.getByText("Synthetic TCWG Deputy", { exact: true })).toBeVisible();
  const columns = intro.locator(":scope > div");
  const main = await columns.nth(0).boundingBox();
  const aside = await columns.nth(1).boundingBox();
  const row = await intro.boundingBox();
  expect(main!.width).toBeGreaterThan(aside!.width * 1.5);
  expect(aside!.x + aside!.width).toBeCloseTo(row!.x + row!.width, 0);
  // The portrait is the design-system Avatar: a sized box that centers its initials.
  const initials = intro.locator(".person-card-avatar-frame .pk-avatar__initials").first();
  expect(await initials.evaluate((el) => getComputedStyle(el.parentElement!).display)).toBe("flex");
  const social = intro.getByRole("link", { name: /Synthetic TCWG Deputy on LinkedIn/ });
  await expect(social.locator("svg path")).toHaveCount(1);
  expect((await social.boundingBox())!.width).toBeLessThanOrEqual(28);
  await intro.screenshot({ path: test.info().outputPath("working-group-desktop.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileMain = await columns.nth(0).boundingBox();
  const mobileAside = await columns.nth(1).boundingBox();
  expect(mobileAside!.y).toBeGreaterThan(mobileMain!.y + mobileMain!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await intro.screenshot({ path: test.info().outputPath("working-group-mobile.png") });

  await page.evaluate(() => localStorage.setItem("pk-theme", "dark"));
  await page.reload();
  await expect(intro.getByText("Synthetic TCWG Deputy", { exact: true })).toBeVisible();
  await intro.screenshot({ path: test.info().outputPath("working-group-dark.png") });
  const contrasts = await intro.locator(".person-card-name, .person-card-jobtitle").evaluateAll((names) =>
    names.map((name) => {
      const luminance = (color: string) => {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((value) => {
            const srgb = value / 255;
            return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
          });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const foreground = luminance(getComputedStyle(name).color);
      const background = luminance(getComputedStyle(name.closest(".person-card")!).backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    }),
  );
  for (const contrast of contrasts) expect(contrast).toBeGreaterThanOrEqual(4.5);
});

test("blog sponsor artwork stays inside its column at every width", async ({ page }) => {
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/2025/01/30/key-takeaways-of-the-pqc-conference-in-austin/");
    const sidebar = page.locator(".blog-sidebar-sponsors");
    const logos = sidebar.locator("img.sponsor-logo");
    await expect(logos).toHaveCount(2);
    const bounds = await sidebar.boundingBox();
    for (const logo of await logos.all()) {
      await expect(logo).toBeVisible();
      await expect.poll(() => logo.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
      const box = await logo.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(bounds!.x + 12);
      expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width - 12);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await sidebar.screenshot({ path: test.info().outputPath(`blog-sponsors-${width}.png`) });
  }
});

test("published logo artwork remains readable on the dark homepage", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const logo = page.locator('.members-overview img[alt="Synthetic member"]').first();
  await expect(logo).toBeVisible();
  await expect
    .poll(() => logo.evaluate((el) => getComputedStyle(el.parentElement!).backgroundColor))
    .toBe("rgba(0, 0, 0, 0)");
  await page.locator(".members-overview").scrollIntoViewIfNeeded();
  await expect.poll(() => logo.evaluate((el) => getComputedStyle(el).filter)).toContain("invert(1)");
  const sponsor = page.locator('.members-overview img[alt="Synthetic sponsor"]').first();
  await expect(sponsor).toBeVisible();
  expect(await sponsor.evaluate((el) => getComputedStyle(el.parentElement!).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  expect(await logo.evaluate((el) => getComputedStyle(el).filter)).not.toMatch(/opacity|contrast/);
  const whiteArtwork = page.locator('.members-overview img[alt="White artwork"]').first();
  await whiteArtwork.evaluate((image: HTMLImageElement) => {
    image.loading = "eager";
  });
  await expect(whiteArtwork).toHaveAttribute("data-logo-ink", "light");
  await expect
    .poll(() => whiteArtwork.evaluate((el) => getComputedStyle(el).filter))
    .toBe("grayscale(1) invert(1) invert(1)");
});

test("donation columns, table, and callout stay readable at desktop and mobile widths", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/donate/");
  const form = page.locator("[data-donation-form]");
  const text = page.getByRole("heading", { name: 'The real cost of "free"' });
  const formBox = await form.boundingBox();
  const textBox = await text.boundingBox();
  expect(formBox!.x).toBeGreaterThan(textBox!.x + textBox!.width);
  const table = page.getByRole("table");
  await expect(table.getByRole("columnheader")).toHaveText(["Amount", "What your gift makes possible"]);
  const amounts = table.locator("tbody td:first-child");
  await expect(amounts).toHaveCount(6);
  expect(await amounts.first().evaluate((el) => getComputedStyle(el).textAlign)).toMatch(/^(right|end)$/);
  const cell = await amounts.first().evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      fontSize: parseFloat(style.fontSize),
      lineHeight: parseFloat(style.lineHeight),
      padding: parseFloat(style.paddingTop),
    };
  });
  expect(cell.fontSize).toBe(14);
  expect(cell.lineHeight / cell.fontSize).toBeGreaterThanOrEqual(1.5);
  expect(cell.padding).toBeGreaterThanOrEqual(12);
  const callout = page.locator(".pk-content-alert.pk-alert--info");
  await expect(callout).toBeVisible();
  expect(await callout.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: test.info().outputPath(`donate-${colorScheme}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await table
      .locator("..")
      .screenshot({ path: test.info().outputPath(`donate-table-${colorScheme}.png`), animations: "disabled" });
    const rowColors = await table
      .locator("tbody tr")
      .evaluateAll((rows) => rows.map((row) => getComputedStyle(row).backgroundColor));
    expect(rowColors[0]).not.toBe(rowColors[1]);
    expect(rowColors[0]).toBe(rowColors[2]);
    const contrasts = await callout.evaluate((el) => {
      const context = document.createElement("canvas").getContext("2d")!;
      const luminance = (color: string) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b] = [...context.getImageData(0, 0, 1, 1).data]
          .slice(0, 3)
          .map((n) => n / 255)
          .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
        return r * 0.2126 + g * 0.7152 + b * 0.0722;
      };
      const style = getComputedStyle(el);
      const foreground = luminance(style.color);
      const background = luminance(style.backgroundColor);
      const calloutContrasts = [(Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)];
      const prose = document.querySelector(".pk-table")!.parentElement!.parentElement!;
      const tableContrasts = [
        ...document.querySelectorAll(".pk-table th, .pk-table td, [data-donation-form] h3"),
        ...prose.querySelectorAll(":scope > p"),
      ].map((cell) => {
        const foreground = luminance(getComputedStyle(cell).color);
        let surface: Element | null = cell;
        while (surface && getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)")
          surface = surface.parentElement;
        const background = luminance(getComputedStyle(surface!).backgroundColor);
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      });
      return [...calloutContrasts, ...tableContrasts];
    });
    expect(contrasts).toHaveLength(24);
    for (const contrast of contrasts) expect(contrast).toBeGreaterThanOrEqual(4.5);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath("donate-desktop.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await form.boundingBox())!.y).toBeGreaterThan((await text.boundingBox())!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath("donate-mobile.png"), fullPage: true, animations: "disabled" });
});

test("dark homepage titles use readable ink and navigation emits no unload warning", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "dark" });
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (/permissions.policy.*unload/i.test(message.text())) warnings.push(message.text());
  });
  await page.goto("/");
  const titles = page.locator(".pkic-wg-spotlight-body h3, .blog-card-summary, .blog-author-avatars-names");
  await expect(titles.first()).toBeVisible();
  const cards = await page.locator(".pkic-wg-spotlight").evaluateAll((elements) =>
    elements.map((el) => {
      const { x, y, width } = el.getBoundingClientRect();
      return { x, y, width };
    }),
  );
  expect(cards).toHaveLength(5);
  expect(cards[0].y).toBe(cards[2].y);
  expect(cards[3].y).toBe(cards[4].y);
  expect(cards[3].x).toBeGreaterThan(cards[0].x);

  const colors = await titles.evaluateAll((elements) =>
    elements.map((el) => {
      const style = getComputedStyle(el);
      return { foreground: style.color, ink: style.getPropertyValue("--pk-ink").trim() };
    }),
  );
  // Resolve the token through the browser to avoid comparing CSS color syntaxes.
  for (const title of await titles.all()) {
    const contrast = await title.evaluate((el) => {
      const luminance = (value: string) => {
        const channels = value
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((n) => n / 255)
          .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const fg = luminance(getComputedStyle(el).color);
      const bg = luminance(getComputedStyle(el.closest(".pkic-wg-spotlight, .blog-card")!).backgroundColor);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    });
    expect(contrast, JSON.stringify(colors)).toBeGreaterThanOrEqual(4.5);
  }
  await page.screenshot({ path: test.info().outputPath("home-dark.png"), fullPage: true });
  const sectionHeading = page.getByRole("heading", { name: "Working Groups", exact: true });
  for (const explicit of [false, true]) {
    if (explicit) {
      await page.emulateMedia({ colorScheme: "light" });
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    }
    expect(await sectionHeading.evaluate((el) => getComputedStyle(el).webkitTextFillColor)).not.toBe(
      "rgba(0, 0, 0, 0)",
    );
    expect(await sectionHeading.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe("none");
  }
  await page.goto("/about/");
  expect(warnings).toEqual([]);
});

test("footer sponsors retain colored artwork and show tier details on hover and focus", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/about/");
  const wall = page.locator(".footer-member-wall");
  await wall.scrollIntoViewIfNeeded();
  await expect(wall.locator(".banner-track")).toBeVisible();
  await expect(wall.getByText("Our titanium sponsors", { exact: false })).toHaveCount(0);
  const logo = wall.getByRole("img", { name: "Synthetic sponsor", exact: true }).first();
  await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect.poll(() => logo.evaluate((image) => getComputedStyle(image).filter)).toBe("none");
  await expect(page.locator(".member-hovercard")).toBeAttached();
  await logo.hover();
  const card = page.locator(".member-hovercard--visible");
  await expect(card).toBeVisible();
  await expect(card.locator(".member-hovercard-name")).toHaveText("Synthetic sponsor");
  await expect(card.locator(".member-hovercard-slogan")).toHaveText("Synthetic sponsor slogan.");
  await expect(card.locator(".member-hovercard-footer")).toHaveText("Titanium Sponsor");
  await page.mouse.move(0, 0);
  await expect(card).toBeHidden();
  await logo.locator("..").focus();
  await expect(card).toBeVisible();
  await expect(card.locator(".member-hovercard-footer")).toHaveText("Titanium Sponsor");
  await page.screenshot({ path: test.info().outputPath("footer-sponsor-focus.png") });
});
