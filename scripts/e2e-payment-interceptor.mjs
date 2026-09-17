import { writeFileSync } from "node:fs";
import { createPaymentCaptureServer } from "./payment-capture/server.mjs";

const server = createPaymentCaptureServer();
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address === "object") writeFileSync(process.argv[2], `http://127.0.0.1:${address.port}`);
});
server.on("error", (error) => { console.error(error.message); process.exit(1); });
