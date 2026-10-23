import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { publicImageFile } from "./public-image-source.mjs";
import { launchPublicationBrowser } from "./publication-browser.mjs";

/** Email clients need stable JPEG URLs rather than the site's responsive image variants. */
export function publicEmailImagePublisher(output) {
  let browser;
  return {
    async publish(document, pathname) {
      if (!/^\/events\/\d{4}\/[^/]+\/$/.test(pathname)) return [];
      const files = [];
      const organizer = `${pathname.slice(1)}organizational-support.jpg`;
      const source = publicImageFile(`/content-media/${organizer}`, output);
      try {
        await mkdir(dirname(resolve(output, organizer)), { recursive: true });
        await copyFile(source, resolve(output, organizer));
        files.push(organizer);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const wall = document.querySelector(".sponsors:has(.sponsors-tier)");
      if (!wall) return files;
      browser ??= await launchPublicationBrowser();
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 2 });
        await page.setJavaScriptEnabled(false);
        await page.setRequestInterception(true);
        const failures = [];
        page.on("request", async (request) => {
          try {
            const url = new URL(request.url());
            if (url.origin !== "https://pkic.org") return await request.abort();
            const file = resolve(output, `.${decodeURIComponent(url.pathname)}`);
            if (!file.startsWith(`${resolve(output)}/`)) return await request.abort();
            await request.respond({
              status: 200,
              contentType: {
                ".css": "text/css",
                ".svg": "image/svg+xml",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".png": "image/png",
                ".webp": "image/webp",
                ".avif": "image/avif",
                ".woff2": "font/woff2",
              }[extname(file)],
              body: await readFile(file),
            });
          } catch (error) {
            failures.push(error);
            await request.abort();
          }
        });
        const emailDocument = document.cloneNode(true);
        emailDocument.querySelectorAll("script, meta[http-equiv]").forEach((node) => node.remove());
        emailDocument.documentElement.setAttribute("data-theme", "light");
        emailDocument.body.innerHTML = wall.outerHTML;
        const base = emailDocument.createElement("base");
        base.href = `https://pkic.org${pathname}`;
        emailDocument.head.prepend(base);
        await page.setContent(emailDocument.documentElement.outerHTML, { waitUntil: "networkidle0" });
        await page.evaluate(async () => {
          await document.fonts.ready;
          for (const image of document.images) {
            image.loading = "eager";
            await image.decode();
          }
        });
        if (failures.length) throw new AggregateError(failures, "Email sponsor image dependencies failed");
        const image = `${pathname.slice(1)}sponsors.jpg`;
        await mkdir(dirname(resolve(output, image)), { recursive: true });
        await (await page.$(".sponsors")).screenshot({ path: resolve(output, image), type: "jpeg", quality: 90 });
        files.push(image);
      } finally {
        await page.close();
      }
      return files;
    },
    async finish() {
      await browser?.close();
      browser = undefined;
    },
  };
}
