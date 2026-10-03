import { publicationCacheDirectory } from "./build-context.mjs";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createBrotliDecompress } from "node:zlib";

const require = createRequire(import.meta.url);

/** Build-only Linux runtime: bundled libraries, no root or system package installation. */
export async function linuxDiagramBrowserOptions(cacheDirectory = publicationCacheDirectory("publication-browser")) {
  const packageDirectory = resolve(dirname(require.resolve("@sparticuz/chromium")), "..");
  const { version } = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
  const cache = resolve(cacheDirectory, `linux-x64-${version}`);
  try {
    await access(join(cache, "ready"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(dirname(cache), { recursive: true });
    const temporary = await mkdtemp(`${cache}-`);
    const packageRequire = createRequire(join(packageDirectory, "build/index.js"));
    const { extract } = packageRequire("tar-fs");
    try {
      await pipeline(
        createReadStream(join(packageDirectory, "bin/chromium.br")),
        createBrotliDecompress(),
        createWriteStream(join(temporary, "chromium"), { mode: 0o700 }),
      );
      for (const archive of ["al2023", "fonts"]) {
        const target = join(temporary, archive);
        await mkdir(target);
        await pipeline(
          createReadStream(join(packageDirectory, `bin/${archive}.tar.br`)),
          createBrotliDecompress(),
          extract(target),
        );
      }
      await writeFile(
        join(temporary, "fonts/fonts.conf"),
        '<?xml version="1.0"?><fontconfig><dir prefix="relative">fonts</dir><cachedir prefix="relative">cache</cachedir></fontconfig>',
      );
      await writeFile(join(temporary, "ready"), version);
      await rename(temporary, cache);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  return {
    executablePath: join(cache, "chromium"),
    headless: "shell",
    args: ["--no-sandbox", "--disable-gpu", "--disable-webgl", "--disable-dev-shm-usage"],
    env: {
      ...process.env,
      LD_LIBRARY_PATH: [join(cache, "al2023/lib"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
      FONTCONFIG_PATH: join(cache, "fonts"),
    },
  };
}
