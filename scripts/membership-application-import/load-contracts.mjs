import { fileURLToPath } from "node:url";
import { build } from "vite";

/** Bundle the canonical contracts in memory; their extensionless TS imports are not native Node imports. */
export async function loadImportContracts() {
  const result = await build({
    configFile: false,
    publicDir: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      target: "node22",
      lib: { entry: fileURLToPath(new URL("./contracts-entry.mjs", import.meta.url)), formats: ["es"] },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output);
  const chunks = outputs.filter((item) => item.type === "chunk");
  if (chunks.length !== 1 || chunks[0].imports.length)
    throw new Error("Could not load self-contained import contracts");
  return import(`data:text/javascript;base64,${Buffer.from(chunks[0].code).toString("base64")}`);
}
