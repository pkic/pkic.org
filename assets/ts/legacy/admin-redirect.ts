import { legacyAdminRedirectTarget } from "./admin-redirects";

const legacyPath = window.location.hash.replace(/^#/, "") || "/";
window.location.replace(legacyAdminRedirectTarget(legacyPath) ?? "/portal/");
