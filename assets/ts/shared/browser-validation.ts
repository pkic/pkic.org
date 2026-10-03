import { z } from "zod";

// Configure Zod before feature imports construct their canonical schemas.
// Object construction otherwise probes eval, even when parsing would fall back.
z.config({ jitless: true });
