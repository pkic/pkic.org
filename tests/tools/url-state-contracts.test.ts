import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
const script = path.resolve(import.meta.dirname, "../../scripts/check-url-state-contracts.mjs");
function findings(view: string) {
  const root = mkdtempSync(path.join(tmpdir(), "url-state-contract-"));
  const files = {
    "assets/ts/components/ApiDataTable.tsx": "export function ApiDataTable(p: any) { return null; }",
    "assets/ts/ui/TabList.tsx": "export function TabList(p: any) { return null; }",
    "assets/ts/ui/GridListToggle.tsx": "export function GridListToggle(p: any) { return null; }",
    "node_modules/preact/hooks/index.d.ts": "export declare function useState<T>(v:T): [T,(v:T)=>void];",
    "assets/ts/hooks/useRouteView.ts": "export declare function useRouteView(): [string, (value:string)=>void];",
    "assets/ts/view.tsx": view,
  };
  try {
    for (const [name, source] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), source);
    }
    let output: string;
    try {
      output = execFileSync(process.execPath, [script, "--root", root, "--json"], { encoding: "utf8" });
    } catch (error) {
      output = (error as { stdout: string }).stdout;
    }
    return JSON.parse(output) as { count: number; diagnostics: { control: string }[] };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
describe("URL state AST contracts", () => {
  it("resolves aliased canonical collection imports and requires explicit ownership", () => {
    expect(findings('import {ApiDataTable as Table} from "./components/ApiDataTable"; const x=<Table />;').count).toBe(
      1,
    );
    expect(
      findings('import {ApiDataTable as Table} from "./components/ApiDataTable"; const x=<Table urlState="users" />;')
        .count,
    ).toBe(0);
  });
  it("traces local state through derived aliases feeding navigation controls", () => {
    const result = findings(
      'import {useState as state} from "preact/hooks"; import {TabList} from "./ui/TabList"; import {GridListToggle} from "./ui/GridListToggle"; const [tab]=state("a"); const derived=tab; const [view]=state("grid"); const a=<TabList activeId={derived}/>; const b=<GridListToggle value={view}/>;',
    );
    expect(result.count).toBe(2);
  });
  it("does not misclassify passthrough props or unrelated transient form state", () => {
    expect(
      findings(
        'import {useState} from "preact/hooks"; import {TabList} from "./ui/TabList"; function View(p:{tab:string}) { const [loading]=useState(false);return <TabList activeId={p.tab}/>; }',
      ).count,
    ).toBe(0);
  });
  it("does not treat similarly named unrelated components as canonical controls", () => {
    expect(findings("function ApiDataTable(){return null;} const x=<ApiDataTable/>;").count).toBe(0);
  });
  it("traces nested wrappers, renamed destructured props and derived caller values", () => {
    const result = findings(
      'import {useState as state} from "preact/hooks"; import {GridListToggle as Toggle} from "./ui/GridListToggle"; function Inner({display: selected}:{display:any}) { return <Toggle value={selected}/>; } function Outer(p:{mode:any}) {return <Inner display={p.mode}/>;} const [value]=state("grid"); const derived=value === "grid" ? "grid" : "list"; const x=<Outer mode={derived}/>;',
    );
    expect(result.count).toBe(1);
    expect(result.diagnostics[0].control).toBe("Outer");
  });
  it("accepts URL-selected loaded records and permission-dependent default fallbacks", () => {
    const result = findings(
      'import {useState} from "preact/hooks"; import {useRouteView} from "./hooks/useRouteView"; import {TabList} from "./ui/TabList"; function View(){ const [rows]=useState([{date:"today"}]); const [allowed]=useState(false); const [day]=useRouteView(); const row=rows.find(value=>value.date===day) ?? rows[0]; const active=day === "edit" && !allowed ? "overview" : day; return <><TabList activeId={row.date}/><TabList activeId={active}/></>; }',
    );
    expect(result.count).toBe(0);
  });
});
