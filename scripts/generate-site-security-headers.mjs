import { writeFile } from "node:fs/promises";
import { siteStaticHeaders } from "../assets/shared/site-security-policy.ts";

await writeFile(new URL("../static/_headers", import.meta.url), siteStaticHeaders());
