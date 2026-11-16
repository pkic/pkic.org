import type { ViteDevServer } from "vite";

export const GALLERY_PORT: number;
export function startGallery(options?: { port?: number; host?: string }): Promise<ViteDevServer>;
