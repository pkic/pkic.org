// Prepare Vite's source-module graph before timing requests. Production loads
// prebuilt chunks; startup performance is measured on that bundle with Wrangler.
import "../../functions/router";
