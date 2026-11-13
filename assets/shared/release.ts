declare const __PKIC_RELEASE__: string | undefined;

/**
 * The release this code was built as, which the Worker and the pages of one
 * deploy share; "dev" where no build named one, such as in tests.
 */
export const PKIC_RELEASE: string = typeof __PKIC_RELEASE__ === "string" && __PKIC_RELEASE__ ? __PKIC_RELEASE__ : "dev";
