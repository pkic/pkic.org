---
authors:
- Ben Wilson
date: "2016-02-18T16:15:16+00:00"
dsq_thread_id:
- 4588964321
keywords:
- mixed content
- ssl
- https
- policy
- w3c
- vulnerabilities
- hsts
tags:
- Mixed Content
- SSL/TLS
- Policy
- W3C
- Vulnerability
- HSTS
title: Moving to Always on HTTPS, Part 2 of 2; Upgrading to HTTP Strict Transport
  Security


---
Part 1 of this blog post discussed browser security indicators and how to avoid getting warnings about mixed content on your website.  (Mixed content leaves a door open that allows an attacker to snoop or inject malicious content during the browsing session.)  This Part 2 discusses other technical measures to implement Always on HTTPS.  As I noted previously, one of the difficulties with implementing Always on HTTPS is that content is often provided by third parties.  I suggested that you require HTTPS from them as well. However, until you are able to get them to do this you will need to find another way to serve up content via HTTPS.  One approach is to collect the material locally and serve it up from the same origin – your HTTPS server.

A key concept is the security model governing the way that browsers retrieve and use content.  This is known as the Same-Origin Policy.  It dictates that browsers trust content provided by the same HTTPS site, but treat content from different origins without that trust. “Roughly speaking, two URIs are part of the same origin (i.e., represent the same principal) if they have the same scheme, host, and port.”  Section 3.2 (Origin) in “RFC 6454:  The Web Origin Concept”,  <https://tools.ietf.org/html/rfc6454>.   Cross-origin privileges created by mixed content are controlled in order to protect against security vulnerabilities.  So, make everything HTTPS by making it originate from your own secure servers.

Once you have configured your web properties with Always on HTTPS, then you can implement HTTP Strict Transport Security (HSTS).  HSTS is a directive included in the header field that forces web browsers to communicate with your site by only using HTTPS.  As outlined in RFC 6797, HSTS provides a mechanism to “force HTTPS.”  By including an HSTS directive in the page header, a web browser is directed to not allow users to click through HTTPS security warnings.  HSTS differs from the Same-Origin Policy (SOP) in that it is an affirmative directive from the website to the browser and that it applies to the connection between the browser and website regardless of the port number (HSTS can be applied on an “entire-host” basis), whereas the Same-Origin Policy is origin-based and limited in scope.    HSTS will protect visitors from downgrade attacks such as SSL Strip. See <http://www.blackhat.com/presentations/bh-dc-09/Marlinspike/BlackHat-DC-09-Marlinspike-Defeating-SSL.pdf>

## Upcoming Developments

One upcoming development is a W3C proposal to upgrade insecure requests with a new Content Security Policy directive.  <https://www.w3.org/TR/upgrade-insecure-requests/>.   “Most notably, mixed content checking has the potential to cause real headache for administrators tasked with moving substantial amounts of legacy content onto HTTPS. In particular, going through old content and rewriting resource URLs manually is a huge undertaking. Moreover, it’s often the case that truly legacy content is difficult or impossible to update. Consider the BBC’s archived websites, or the New York Times’ hard-coded URLs.  We should remove this burden from site authors by allowing them to assert to a user agent that they intend a site to load only secure resources, and that insecure URLs ought to be treated as though they had been replaced with equivalent secure URLs.”

A recommendation in the W3C proposal involves processing HSTS before evaluating the page for mixed content.  (“If the origin is HSTS-safe, then protect against SSL-stripping man-in-the-middle attacks by sending a Strict-Transport-Security header with the preload directive, and ensure that insecure content is never loaded by enabling Mixed Content’s strict mode.”)  Browsers should prime and preload HSTS before checking for mixed content using the Same-Origin Policy, but that isn’t how it currently happens – “HSTS is currently checked after mixed content blocking has already happened. This is due to the fundamental property that HSTS takes effect only after a user’s agent has requested a resource from a host that sends the header.” <https://mikewest.github.io/hsts-priming/>   Priming HSTS means that the browser checks whether there is an HTTPS version of the content, and whether the origin has an HSTS record cached in the browser.  A priming request attempts to validate whether an insecure reference has an HSTS policy before blocking it as mixed content, thereby allowing an upgrade from HTTP to HTTPS.

## Conclusion

In this blog post I have discussed the Same-Origin Policy, mixed content, and the security indicators given by browsers when secure HTTPS content is tainted with unsecure HTTP content.  I’ve also provided some tips to help you navigate an error-free presentation of your web content.  Most notably is the HSTS header.  (See <https://casecurity.org/2014/10/08/secure-your-website-with-hsts/> for our HSTS configuration instructions.)  Finally, I introduced you to a new W3C development that will leverage your investment in HSTS even more.