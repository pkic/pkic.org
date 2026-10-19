/**
 * The layout, legibility and naming probes the responsive portal sweep runs
 * on every screen at every width. Each one is a defect the portal has shipped;
 * see `portal-responsive.spec.ts` for why each matters.
 */
import type { Page } from "@playwright/test";

/** The themes every screen is held to; layout is shared, color is not. */
const THEMES = ["light", "dark"] as const;

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(0, root.scrollWidth - root.clientWidth);
  });
}

/** Elements that push the page sideways, skipping anything a scroller clips. */
async function overflowingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const guilty: string[] = [];

    function clipped(element: HTMLElement): boolean {
      let parent = element.parentElement;
      while (parent && parent !== document.documentElement) {
        const overflow = getComputedStyle(parent).overflowX;
        if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") return true;
        parent = parent.parentElement;
      }
      return false;
    }

    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= limit + 1) continue;
      if (clipped(element)) continue;
      if (element.parentElement && element.parentElement.getBoundingClientRect().right > limit + 1) continue;
      guilty.push(`${element.tagName.toLowerCase()}.${element.className || "(none)"} → ${Math.round(rect.right)}px`);
    }
    return guilty;
  });
}

/**
 * Buttons stretched across their column, or touching a neighbour. Row links,
 * tabs, menus and segmented choices are full-width by design and are skipped.
 */
async function crowdedButtons(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const label = (element: Element) => (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    const buttons = [...document.querySelectorAll<HTMLElement>("button, a.pk-btn")].filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width === 0 || rect.height === 0 || rect.right <= 0 || rect.left >= innerWidth) return false;
      if (style.visibility === "hidden" || style.position === "absolute") return false;
      // The sign-in methods are the one sanctioned full-width stack: alternative choices in a narrow card.
      return !element.closest(
        '[role="tablist"], [role="menu"], [role="listbox"], nav, .pk-segmented, .pk-app-tabbar, .pk-login__controls',
      );
    });
    const problems: string[] = [];
    for (const button of buttons) {
      if (!button.classList.contains("pk-btn")) continue;
      const parent = button.parentElement!;
      const style = getComputedStyle(parent);
      const inner = parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const width = button.getBoundingClientRect().width;
      if (width > 200 && width >= inner * 0.9) problems.push(`stretched button "${label(button)}"`);
    }
    for (const a of buttons) {
      for (const b of buttons) {
        if (a === b || !a.classList.contains("pk-btn") || !b.classList.contains("pk-btn")) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const sameRow = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top) > ra.height / 2;
        if (sameRow && rb.left >= ra.right - 1 && rb.left - ra.right < 4)
          problems.push(`buttons touching: "${label(a)}" | "${label(b)}"`);
      }
    }
    return problems;
  });
}

/** Button labels whose color does not stand out from the surface behind them. */
async function illegibleButtons(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // Any CSS color (oklch, color-mix, color()) resolves to sRGB through a canvas.
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const parse = (value: string) => {
      if (!value || value === "transparent") return null;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: alpha / 255 };
    };
    const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const channel = (value: number) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const problems: string[] = [];
    for (const button of document.querySelectorAll<HTMLElement>("button.pk-btn, a.pk-btn")) {
      const rect = button.getBoundingClientRect();
      const text = (button.textContent ?? "").trim();
      if (!text || rect.width === 0 || rect.height === 0) continue;
      let surface: ReturnType<typeof parse> = null;
      let ground: HTMLElement | null = null;
      for (let node: HTMLElement | null = button; node; node = node.parentElement) {
        ground = node;
        const style = getComputedStyle(node);
        // An image or gradient surface cannot be measured from computed color.
        if (style.backgroundImage !== "none") {
          surface = null;
          break;
        }
        const color = parse(style.backgroundColor);
        if (color && color.a > 0.9) {
          surface = color;
          break;
        }
      }
      const ink = parse(getComputedStyle(button).color);
      if (!surface || !ink) continue;
      const [light, dark] = [luminance(ink), luminance(surface)].sort((x, y) => y - x);
      const ratio = (light + 0.05) / (dark + 0.05);
      // Name the button and the ground it was measured on, so a failure says where to look.
      if (ratio < 4.5)
        problems.push(
          `"${text.slice(0, 40)}" contrast ${ratio.toFixed(2)}:1 (${button.className} on ${ground?.className || ground?.tagName.toLowerCase()})`,
        );
    }
    return problems;
  });
}

/** Anything that responds to a click but cannot be focused or activated. */
async function mouseOnlyControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>("[onclick]")) {
      const tag = element.tagName.toLowerCase();
      if (tag === "button" || tag === "a" || tag === "input" || tag === "select" || tag === "textarea") continue;
      if (element.tabIndex >= 0) continue;
      found.push(`${tag}.${element.className || "(none)"}`);
    }
    return found;
  });
}

/** Controls and regions with nothing to announce them by. */
async function unnamedThings(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];

    function named(element: HTMLElement): boolean {
      if (element.getAttribute("aria-label")?.trim()) return true;
      if (element.getAttribute("aria-labelledby")) return true;
      if (element.getAttribute("title")?.trim()) return true;
      if ((element.textContent ?? "").trim()) return true;
      // A link or button whose whole content is an image takes its name from
      // that image's alt text, and an inline SVG from its <title>.
      for (const image of element.querySelectorAll("img[alt]")) {
        if ((image.getAttribute("alt") ?? "").trim()) return true;
      }
      if (element.querySelector("svg > title")?.textContent?.trim()) return true;
      const id = element.getAttribute("id");
      if (id && document.querySelector(`label[for="${id}"]`)) return true;
      return Boolean(element.closest("label"));
    }

    for (const table of document.querySelectorAll("table")) {
      const caption = table.querySelector("caption")?.textContent?.trim();
      if (!caption && !table.getAttribute("aria-label") && !table.getAttribute("aria-labelledby")) {
        problems.push(`table with no name: ${table.className || "(none)"}`);
      }
    }

    for (const control of document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea")) {
      if (control.getAttribute("aria-hidden") === "true") continue;
      if (control instanceof HTMLInputElement && control.type === "hidden") continue;
      if (!named(control)) {
        problems.push(`${control.tagName.toLowerCase()} with no name: ${control.className || "(none)"}`);
      }
    }

    return problems;
  });
}

/**
 * Controls ease their color between themes; measure where they land, not
 * halfway there. A transition replaced before it ends never settles, so the
 * wait is bounded.
 */
async function settleTransitions(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.race([
      Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation instanceof CSSTransition)
          .map((animation) => animation.finished.catch(() => undefined)),
      ),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]),
  );
}

/** Every probe on the page as it stands, labeled with where it ran. */
export async function screenProblems(page: Page, where: string): Promise<string[]> {
  const failures: string[] = [];
  for (const problem of await crowdedButtons(page)) failures.push(`${where}: ${problem}`);
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    await settleTransitions(page);
    for (const problem of await illegibleButtons(page)) failures.push(`${where}/${theme}: ${problem}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await settleTransitions(page);
  for (const problem of await overflowingElements(page)) failures.push(`${where}: overflows — ${problem}`);
  const overflow = await horizontalOverflow(page);
  if (overflow > 0) failures.push(`${where}: page scrolls ${String(overflow)}px sideways`);
  for (const problem of await mouseOnlyControls(page)) failures.push(`${where}: mouse-only control — ${problem}`);
  for (const problem of await unnamedThings(page)) failures.push(`${where}: ${problem}`);
  return failures;
}
