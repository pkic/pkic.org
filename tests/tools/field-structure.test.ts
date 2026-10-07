import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { createTemporaryDirectory } from "./helpers/temporary-directory";

it("recognizes shared Field nesting while rejecting orphaned parts and unrelated components", async () => {
  const script = resolve("scripts/check-field-structure.mjs");
  const root = await createTemporaryDirectory("pkic-field-structure");
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

it("requires a common spacing body for shared fields and actions inside native disclosures", async () => {
  const script = resolve("scripts/check-field-structure.mjs");
  const root = await createTemporaryDirectory("pkic-disclosure-structure");
  try {
    await mkdir(resolve(root, "layouts"));
    await mkdir(resolve(root, "assets/ts"), { recursive: true });
    const check = async (body: string, imports = sharedImports) => {
      await writeFile(
        resolve(root, "assets/ts/Form.tsx"),
        `${imports}<details><summary>Manual entry</summary>${body}</details>`,
      );
      return spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    };
    const sharedImports =
      'import { Field } from "../ui/Field";import { Button } from "../ui/Button";import { FormSection } from "../ui/FormSection";';
    const controls = '<Field label="Code" /><div class="pk-cluster"><Button type="submit">Save</Button></div>';
    expect((await check(controls)).status).toBe(1);
    expect((await check(`<div class="pk-form">${controls}</div>`)).status).toBe(0);
    expect((await check(`<div class="pk-stack">${controls}</div>`)).status).toBe(0);
    expect((await check(`<FormSection title="Details">${controls}</FormSection>`)).status).toBe(0);
    expect((await check(`<div class="pk-form"><Field label="Code" /></div><Button>Save</Button>`)).status).toBe(1);
    expect(
      (await check(controls, 'import { Field } from "./unrelated";import { Button } from "../ui/Button";')).status,
    ).toBe(0);
    expect((await check('<Field label="Code" />')).status).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
