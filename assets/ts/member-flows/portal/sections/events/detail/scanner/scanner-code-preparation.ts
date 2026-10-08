import { createContext } from "preact";

/** The portal entry owns public UI loading; scanner persistence never imports that UI. */
export const ScannerCodePreparation = createContext<((signal: AbortSignal) => Promise<boolean>) | null>(null);
