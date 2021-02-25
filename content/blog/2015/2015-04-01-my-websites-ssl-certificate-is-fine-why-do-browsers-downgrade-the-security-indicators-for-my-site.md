---
authors:
- Rick Andrews
date: "2015-04-01T16:19:02+00:00"
dsq_thread_id:
- 3646401095
keywords:
- attack
- rc4
- encryption
- tls
- ietf
- ev certificate
- chrome
- internet engineering task force
- ssl
tags:
- Attack
- RC4
- Encryption
- SSL/TLS
- IETF
- EV
- Chrome
title: My Website’s SSL Certificate is Fine; Why Do Browsers Downgrade the Security
  Indicators For My Site?


---
All the major browsers provide “security user interface”, meaning visual elements to inform the user of the security of their connection to the web page they’re visiting. Up until now, those interface elements were tied to the use of SSL/TLS certificates served by the web site. For example, if you went to <http://www.example.com>, no special elements would be displayed, but if you visited <https://www.example.com>, you would see a lock icon indicating the presence of a trusted SSL/TLS certificate. You would also see in the address bar the name of the company responsible for the web site, if the web site used an EV certificate. Most browsers change user interface indicators for [mixed content][1] (when a secure page loaded scripts, images or other content from a non-secure site).

In the last year or so, browser vendors began making more changes to their security user interfaces. Chrome, for example, began highlighting the use of SHA-1 by changing the security user interface when any certificate in the chain used SHA-1. See this [blog post][2] for details on what each visual element signifies in Chrome.

Recently, new concerns about weaknesses in [RC4][3], a popular stream encryption algorithm, have led the Internet Engineering Task Force (IETF) TLS Working Group to declare that “RC4 can no longer be seen as providing a sufficient level of security for TLS sessions” (this statement appears in [RFC 7465][4]). RC4 isn’t used in certificates; rather, it is used in various ciphersuites defined for SSL/TLS. And it was strongly favored several years ago because it was immune to the [BEAST attack][5].

But due to present concerns about RC4, some browser vendors are planning to warn users about its use by changing their security user interfaces. If your browser and the website you’re visiting negotiate to use a ciphersuite that includes RC4, browsers will warn you by a security user interface change. If the site has an EV certificate, the browser may decline to show the [EV display][6]. This is important to understand, since users may expect that security user interface warnings indicate a problem with the website’s certificate, but there may be nothing wrong with the certificate or its chain.

Perhaps more importantly, browser vendors are considering security user interface warnings if RC4 is used in any sub-connection used to build a page. Recall that most modern web pages are built on the fly from multiple sources: static images may be served by a Content Distribution Network (CDN), scripts may come from open source sites, and seal images may be served by the Certificate Authority that issued the website’s certificate. The use of RC4 in _any_ of those connections could result in a broken lock icon or the loss of EV display.

We’re not arguing that it’s unwise to warn about RC4 in a sub-connection – we’re just concerned that many website owners may assume something is wrong with their certificate, and it’s very difficult to determine which sub-connection used RC4 and was responsible for the user interface downgrade. Browser vendors can help by developing enhanced error reporting that pinpoints the cause of the downgrade, allowing website owners to quickly remediate the problem. By the way, remediation would consist of re-configuring the offending web server to de-prioritize or remove those ciphersuites that use RC4. Modern alternatives exist that do not use RC4 and therefore are not affected by its weaknesses.

CASC provides a web-based tool called [SSL Server][7] Test to detect problems with SSL/TLS certificates and chains, as well as server configuration. SSL Server Test will tell you if the website is configured to use RC4-based ciphersuites, but it only checks the primary connection and ignores sub-connections. CASC is investigating tools and methods to locate websites that still use RC4, to help our customers address RC4-related issues and restore favorable security user interface indicators.

 [1]: https://help.blackboard.com/en-us/Learn/9.1_2014_04/Administrator/020_Browser_Support/Browser_Security_and_Mixed_Content
 [2]: http://blog.chromium.org/2014/09/gradually-sunsetting-sha-1.html
 [3]: https://en.wikipedia.org/wiki/RC4
 [4]: https://tools.ietf.org/html/rfc7465
 [5]: https://en.wikipedia.org/wiki/BEAST_attack
 [6]: https://en.wikipedia.org/wiki/Extended_Validation_Certificate#User_interface
 [7]: https://casecurity.ssllabs.com/