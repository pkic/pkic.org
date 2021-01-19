---
title: Secure Your Website with HSTS
authors: [Bruce Morton]
date: 2014-10-08T15:05:10+00:00
dsq_thread_id:
  - 3096189901


---
Is your website secure? One thing to consider is securing your website with [HTTP Strict Transport Security (HSTS)][1].

Implementation of HSTS is an extension of the [Always-On SSL][2] policy. For each website you want to protect with HSTS, you must first deploy an SSL/TLS certificate (if you haven’t already), and configure that website to be accessible only via HTTPS, not via HTTP. Then you convey to HSTS-enabled browsers that your site is only available with HTTPS, by sending the HSTS header value. Supporting browsers will automatically change any HTTP query for your website into an HTTPS query. If there is no HTTPS version available, then the browser will provide a trust dialogue to the user.

HSTS is defined in the [IETF RFC 6797][3] and is being deployed in most browsers. Browsers which do not support HSTS will just ignore the HSTS header value, so website administrators do not have to wait for full browser support.

### Mitigated Risks

HSTS will help to mitigate attacks using the [sslstrip][4] tool, which will take a request for an HTTPS domain and change it to a request to a similar site with an HTTP domain. With HSTS, the name change from HTTPS to HTTP will be detected by the browser.

HSTS will also mitigate the following security issues:

  * User bookmarks or manually typed http domains will be redirected to HTTPS for the target domain
  * An HTTPS site that inadvertently contains an HTTP link will be redirected to HTTPS for the target domain
  * In the case where a man-in-the-middle attack redirects the user to an invalid certificate, HSTS will not allow the user to override the invalid certificate message

Some will say, “Why do I need to protect my website with HTTPS when we are not asking for any sensitive data?”

There are two items to consider. First, it is best to provide a single look and feel to your website. Using HTTP in some places and HTTPS in other place does not give a consistent view to your users and they do not know what to expect.

Second, asking for sensitive data may not be the privacy or security concern. Your user may just want the communication secured, so that no third party knows they have gone to your website.

### Implementation

For your website, HSTS is implemented at the Web server, which needs to provide a new header in the HTTPS connection. Here is an example of the information contained in the header:

> Strict-Transport-Security: max-age=15768000; includeSubDomains

When the HSTS supported browser sees this, it understands that HSTS is turned on. It will remember for the specified period (e.g., “max-age” in seconds) that the current domain can only be contacted over HTTPS. If the user subsequently tries to connect to the site with HTTP only, the browser will default to HTTPS. The “includeSubDomains” extension will enforce the HSTS policy on all subdomains under the current domain.

### Limitations

HSTS has some limitations, most of which are addressed in the Security Considerations section of RFC 6797. HSTS is also limited with the first use of the website or when maximum age listed in the header expires.

For website first use, the browser must trust-on-first-use (TOFU) as it has not previously received an HSTS header. The TOFU issue has been addressed by Google for Chrome and has been extended out to Firefox and Safari.

To avoid the TOFU issue, you must first register your site with Google and have the domain added to the [HSTS preload list][5]. In this case, when the browser goes to your site, it will know that it must be secured with HTTPS per its inclusion on the preload list. Please note that the preload list is not scalable for all sites and is only available for early adopters. Also, the preload list is not supported by all browsers.

Also, it is assumed that the users will re-engage the website many times. At each visit to the site, the browser will download the HSTS header and the maximum age will be extended from that time. If the users do not visit the site until after the maximum age expires, then the browser will not know that your site is to be viewed in HTTPS only. An attack could be mitigated, if the website was on the HSTS preload list.

### Supportability

HSTS is supported on Chrome, Firefox, Opera and Safari. It will also be [supported in Internet Explorer 12][6] when it is released this year. You can check “[Can I use Strict Transport Security?][7]” for the browsers that are HSTS-supported.

### How About an HTTPS Redirect?

Most website administrators are quite familiar with redirects and it’s natural for them to suggest using this technique to force connections from HTTP to HTTPS as a tried and true alternative to HSTS. Unfortunately, the redirect requires an initial connection to the server over HTTP that is susceptible to an attack. An adversary could obtain non-secure session cookies when the browser initially connects to the site, and the can also inject malicious content – such as a fake login page – in the non-encrypted response. Once the browser is aware that a site requires HTTPS via HSTS, it is more secure than a simple redirect.

### Support Extension

ICANN is currently approving many new generic top-level domains (gTLDs). [Adam Langley][8] suggests that the new gTLDs could set HSTS for the entire site by including the gTLD in the preload list before registering an associated domain name. It’s something to think about for differentiation as the new gTLDs could be secure right from the start.

If your domain registry does not use HSTS, then maybe you should consider it before you start your site. Why not enable HTTPS security right from the get go?

 [1]: https://en.wikipedia.org/wiki/HTTP_Strict_Transport_Security
 [2]: https://casecurity.org/2014/01/16/always-on-ssl-part-i/
 [3]: https://www.ietf.org/rfc/rfc6797.txt
 [4]: http://www.thoughtcrime.org/software/sslstrip/
 [5]: https://hstspreload.appspot.com/
 [6]: http://threatpost.com/ie-12-to-support-hsts-encryption-protocol
 [7]: http://caniuse.com/stricttransportsecurity
 [8]: https://www.imperialviolet.org/2014/07/06/newtlds.html