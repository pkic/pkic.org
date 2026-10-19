/** The private portal resolves the existing session before offering sign-in. */
const mount = document.getElementById("portal-app");
if (mount?.dataset.clientDev === "true") {
  // Development follows the bundle rebuilt by the watching client process.
  const entry = "/js/built/chunks/portal-page.js";
  await import(/* @vite-ignore */ entry);
} else {
  await import("../assets/ts/member-flows/portal-page");
}
if (mount) mount.inert = false;

export {};
