export function logInfo(message: string, data?: unknown): void {
  console.log(JSON.stringify({ level: "info", message, data: data ?? null }));
}

export function logError(message: string, data?: unknown): void {
  console.error(JSON.stringify({ level: "error", message, data: data ?? null }));
}
