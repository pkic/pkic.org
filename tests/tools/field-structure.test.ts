import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("recognizes shared Field nesting while rejecting orphaned parts and unrelated components", async () => {
  const script = resolve("scripts/check-field-structure.mjs");
  const root = await mkdtemp(resolve(tmpdir(), "pkic-field-structure-"));
  try {
    await mkdir(resolve(root, "layouts"));
    await mkdir(resolve(root, "assets/ts"), { recursive: true });
    const check = async (source: string) => {
      await writeFile(resolve(root, "assets/ts/Form.tsx"), source);
      return spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    };
    const sharedImport = 'import { Field } from "../ui/Field";';
    expect(
      (await check(`${sharedImport}<Field label="Comments">{() => <p class="pk-field__message" />}</Field>`)).status,
    ).toBe(0);
    expect((await check(`${sharedImport}<Field label="Comments" /><p class="pk-field__message" />`)).status).toBe(1);
    expect(
      (await check('import { Field } from "./unrelated";<Field><p class="pk-field__message" /></Field>')).status,
    ).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
