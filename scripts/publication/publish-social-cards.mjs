import { createHash, randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import satori from "satori";
import sharp from "sharp";
import { socialCardLayout } from "./social-card-layout.mjs";
import { formatServiceDate, EMPTY_DATE } from "../../assets/shared/format-date.ts";
import { boundedImageSource } from "./bounded-image-source.mjs";
import { publicImageFile } from "./public-image-source.mjs";

const WIDTH = 1200;
const HEIGHT = 630;
const digest = (value) => createHash("sha256").update(value).digest("hex");

export async function renderSocialCard(card, assets, fonts) {
  const maxBottom = card.authors.length || card.date ? 360 : 390;
  const rasterize = async (svg, bounds, fontSize, truncated = false) => {
    const bytes = await sharp(Buffer.from(svg)).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    const metadata = await sharp(bytes).metadata();
    if (metadata.width !== WIDTH || metadata.height !== HEIGHT || bytes.length > 700_000)
      throw new Error(`Social card does not meet the publication image budget: ${card.route}`);
    return { bytes, bounds, fontSize, truncated };
  };
  for (const fontSize of [60, 56, 52, 48, 44, 40, 36, 32, 28]) {
    let bounds;
    const options = {
      width: WIDTH,
      height: HEIGHT,
      fonts,
      onNodeDetected(node) {
        if (node.props.id === "card-title")
          bounds = { x: node.left, y: node.top, width: node.width, height: node.height };
      },
    };
    await satori(socialCardLayout(card, assets, fontSize), options);
    if (!bounds || bounds.y + bounds.height > maxBottom) continue;
    const bodyHeight = bounds.height + (card.description ? 90 : 0) + (card.authors.length || card.date ? 44 : 0);
    const titleTop = Math.max(112, Math.min(190, (550 - bodyHeight) / 2));
    const svg = await satori(
      socialCardLayout(card, assets, fontSize, titleTop + bounds.height, undefined, titleTop),
      options,
    );
    return rasterize(svg, bounds, fontSize);
  }
  const fontSize = 28;
  const titleLines = Math.floor((maxBottom - 112) / (fontSize * 1.12));
  let bounds;
  const svg = await satori(socialCardLayout(card, assets, fontSize, maxBottom, titleLines), {
    width: WIDTH,
    height: HEIGHT,
    fonts,
    onNodeDetected(node) {
      if (node.props.id === "card-title")
        bounds = { x: node.left, y: node.top, width: node.width, height: node.height };
    },
  });
  return rasterize(svg, bounds, fontSize, true);
}

/** Page metadata and the raster image are published together, or the build fails. */
export async function publicSocialCardPublisher(output) {
  const fonts = await Promise.all(
    [400, 700].map(async (weight) => ({
      name: "Roboto",
      weight,
      style: "normal",
      data: await readFile(
        new URL(`../../static/fonts/Roboto-${weight === 400 ? "Regular" : "Bold"}.ttf`, import.meta.url),
      ),
    })),
  );
  const revision = digest(
    Buffer.concat([
      await readFile(new URL("./social-card-layout.mjs", import.meta.url)),
      await readFile(new URL("./publish-social-cards.mjs", import.meta.url)),
      ...fonts.map((font) => font.data),
      await readFile(new URL("../../pnpm-lock.yaml", import.meta.url)),
      Buffer.from(JSON.stringify({ sharp: sharp.versions })),
    ]),
  );
  const images = new Map();
  const logoTones = new Map();
  async function lightLogo(source) {
    if (!source) return false;
    if (!logoTones.has(source))
      logoTones.set(
        source,
        (async () => {
          const { data } = await sharp(Buffer.from(source.split(",")[1], "base64"))
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
          let color = 0;
          let alpha = 0;
          for (let index = 0; index < data.length; index += 4) {
            color += (data[index] + data[index + 1] + data[index + 2]) * data[index + 3];
            alpha += data[index + 3];
          }
          return alpha > 0 && color / (3 * alpha) > 210;
        })(),
      );
    return logoTones.get(source);
  }
  async function embed(source) {
    if (!source) return null;
    const file = publicImageFile(source, output, { allowSvg: true });
    if (!file) return null; // Remote imagery is not part of the approved static release.
    if (!images.has(file))
      images.set(
        file,
        readFile(file).then(async (bytes) => {
          const { input } = await boundedImageSource(bytes, {
            maxWidth: WIDTH,
            maxHeight: HEIGHT,
            limitInputPixels: 100_000_000,
          });
          return sharp(bytes, input)
            .rotate()
            .resize({ width: 1200, height: 630, fit: "inside", withoutEnlargement: true })
            .png()
            .toBuffer()
            .then((png) => `data:image/png;base64,${png.toString("base64")}`);
        }),
      );
    return images.get(file);
  }
  const brand = await embed("/img/logo.svg");
  const directory = resolve(output, "_published/social");
  const cache = resolve(process.env.PKIC_PUBLICATION_SOCIAL_CACHE ?? "node_modules/.astro/publication-social");
  await Promise.all([mkdir(directory, { recursive: true }), mkdir(cache, { recursive: true })]);
  const manifest = [];
  return {
    manifest,
    async publish(document) {
      const template = document.querySelector("#pkic-social-card");
      if (!template) {
        for (const meta of document.querySelectorAll('meta[property^="og:image"], meta[name="twitter:image"]'))
          meta.remove();
        return;
      }
      const card = JSON.parse(template.content.textContent);
      template.remove();
      const text = (value) =>
        JSDOM.fragment(value ?? "")
          .textContent.replace(/\s+/g, " ")
          .trim();
      card.title = text(card.title);
      card.description = text(card.description);
      card.label = text(card.label);
      if (!card.title || !card.label) throw new Error(`Social card has no title or label: ${card.route}`);
      if (card.date) {
        const formatted = formatServiceDate(card.date);
        card.date = formatted === EMPTY_DATE ? undefined : formatted;
      }
      const withPhoto = async (person) => ({ ...person, photo: await embed(person.photo) });
      const withLogo = async (logo) => {
        const src = await embed(logo.src);
        return { ...logo, src, dark: await lightLogo(src) };
      };
      const visual = await embed(card.visual);
      const assets = {
        brand,
        hero: await embed(card.hero),
        visual,
        visualDark: await lightLogo(visual),
        authors: await Promise.all(card.authors.map(withPhoto)),
        leaders: await Promise.all(card.leaders.map(withPhoto)),
        logos: (await Promise.all(card.logos.map(withLogo))).filter((logo) => logo.src),
        sponsors: (await Promise.all(card.sponsors.map(withLogo))).filter((logo) => logo.src),
      };
      const hash = digest(JSON.stringify({ revision, card, assets }));
      const filename = `${hash}.jpg`;
      const cached = resolve(cache, filename);
      const details = resolve(cache, `${hash}.json`);
      let rendered;
      try {
        await access(cached);
        rendered = JSON.parse(await readFile(details, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        const { bytes, ...measurement } = await renderSocialCard(card, assets, fonts);
        rendered = { ...measurement, bytes: bytes.length };
        const temporary = `${cached}.${randomUUID()}.tmp`;
        await writeFile(temporary, bytes);
        await rename(temporary, cached);
        const temporaryDetails = `${details}.${randomUUID()}.tmp`;
        await writeFile(temporaryDetails, JSON.stringify(rendered));
        await rename(temporaryDetails, details);
      }
      await copyFile(cached, resolve(directory, filename));
      const url = `/_published/social/${filename}`;
      for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
        const meta = document.querySelector(selector);
        if (!meta) throw new Error(`Social metadata is missing: ${card.route}`);
        meta.setAttribute("content", new URL(url, "https://pkic.org").href);
        meta.removeAttribute("data-pagefind-default-meta");
      }
      const searchImage = document.createElement("meta");
      searchImage.name = "pagefind:image";
      // Member results identify the organization, rather than whichever
      // representative portrait Pagefind encounters first in the body.
      searchImage.content = card.kind === "member" && visual ? card.visual : url;
      searchImage.setAttribute("data-pagefind-meta", "image[content]");
      document.head.append(searchImage);
      const alt = `${card.title} — PKI Consortium`;
      for (const [attribute, name] of [
        ["property", "og:image:alt"],
        ["name", "twitter:image:alt"],
      ]) {
        const meta = document.createElement("meta");
        meta.setAttribute(attribute, name);
        meta.content = alt;
        document.head.append(meta);
      }
      manifest.push({ route: card.route, kind: card.kind, url, alt, width: WIDTH, height: HEIGHT, ...rendered });
    },
    async finish() {
      await writeFile(resolve(directory, "cards.json"), JSON.stringify(manifest));
      return [...new Set(manifest.map((card) => card.url.slice(1))), "_published/social/cards.json"];
    },
  };
}
