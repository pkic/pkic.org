/**
 * Local corrections to the vendored lists, reviewed like code.
 *
 * Add a provider the upstream lists miss (typically a consumer ISP mailbox we
 * see in our own data) or remove an entry that is in fact one organization's
 * own domain. Each entry is a registrable domain or a host below one, never a
 * public suffix; the email-domain tests hold the file to that. When a refresh
 * shows an addition upstream, drop it here.
 */
export const EMAIL_DOMAIN_OVERRIDES = {
  free: {
    add: [
      // Consumer ISP and mailbox providers missing upstream.
      "bbox.fr",
      "caiway.nl",
      "hey.com",
      "kabelmail.de",
      "kpnplanet.nl",
      "mailbox.org",
      "numericable.fr",
      "onsbrabantnet.nl",
      "outlook.co.uk",
      "sympatico.ca",
      "talktalk.net",
      "tutanota.com",
      "zeelandnet.nl",
    ],
    remove: [
      // The National University of Singapore's own domain, not a free mailbox.
      "nus.edu.sg",
    ],
  },
  disposable: {
    add: ["tempmail.com"],
    remove: [] as string[],
  },
} as const;
