---
authors:
- Rick Andrews
- Bruce Morton
date: "2014-06-18T18:50:27+00:00"
dsq_thread_id:
- 2775942548
keywords:
- ssl
- announcement
- revocation
tags:
- SSL/TLS
- Announcement
- Revocation
title: OCSP Must-Staple


---
---
With the announcement of the Heartbleed bug and the resulting need to revoke large numbers of SSL certificates, the topic of certificate revocation has, once again, come to the fore.

There have been many issues with how revocation information is provided to the browsers. First let’s review how SSL certificate status may currently be obtained:
How


| How | Definition | Pros | Cons |
| signed list of the serial numbers of all revoked certificates that were signed by the CA’s certificate. | A single point of reference for the status of all certificates issued by the CA’s certificate. | Over time, CRLs might become very large, resulting in unacceptable latency. An attacker may be in a position to block the CRL delivery. |
| **Online Certificate Status Protocol (OCSP)** | A signed response containing the status of one certificate. | An OCSP response is small and does not grow. As such, there is no latency due to size. | Browsers have to obtain an OCSP response for each certificate in the Web server’s certificate chain, requiring it to open additional connections, thereby impacting page load time. Privacy issues may be a concern as the CA can determine which websites a user is visiting. An attacker may be in a position to block the OCSP delivery. |
| **OCSP Stapling** | A signed response, fetched by the Web server, with the status of its certificate. The OCSP response is then provided by the Web server to the browser. | No privacy issues, as the CA does not know which user has asked for the OCSP response. | Need Web servers and browsers that support OCSP Stapling. An attacker may be in a position to block the OCSP delivery. |
| **Blacklist (for example, CTLs or CRLSets)** | A list of certificates that should not be trusted (whether or not they were revoked), distributed by the browser supplier. | The blacklist is distributed by the browser supplier as part of the browser executable. | Any certificate on the blacklist can be rejected without any additional checks. | For practical reasons, the list is incomplete. |

### Soft-fail Versus Hard-fail

The major concern for browser users is the policy of _soft-fail_ versus _hard-fail_. The issue is that the certification authority (CA) CRL/OCSP response may not get delivered to the browser. This could occur as a result of a non-malicious failure somewhere in the infrastructure. But, it could also occur as a result of an attack.

Browser designers have determined that the former explanation is overwhelmingly more probable, so they have chosen a soft-fail policy. This means if that there if the browser receives no response, then the certificate will be considered good and the browser will allow access to the associated content.

A hard-fail policy, on the other hand, would mean that if the browser received no response, then the certificate would be assumed to be revoked, and the browser would block access to the content. As of this writing, no major browser implements hard-fail.

OCSP stapling almost resolves the problem, as the OCSP response is bundled into the SSL handshake and is thus easily delivered. However, since websites do not yet universally support stapling, the browser cannot distinguish between an uncompromised site that doesn&rsquo;t support stapling, and a compromised site where the OCSP response is blocked.

### OCSP Must-Staple

To resolve these matters, the solution of OCSP Must-Staple has been suggested. If the Web server could securely tell the browser that it supported OCSP Stapling, then the browser would know to expect an OCSP-stapled response. And if no response was received, the browser could hard-fail.

The website administrator has to determine if their site will support OCSP Must-Staple. First, they will have to have their website support OCSP stapling, then they must add the OCSP Must-Staple flag. The design is not finalized, but the OCSP Must-Staple flag can be implemented in two ways:

#### Must-Staple Assertion in the SSL Certificate

In this case, the website administrator has to advise its CA that it wants OCSP Must-Staple. The CA will put an object identifier (OID) extension in the SSL certificate indicating Must-Staple. When a user goes to the website, the browser will review the certificate and see the OCSP Must-Staple indicator. It will then require an OCSP-stapled response from the Web server. If no response is received, then the browser will hard-fail.

There is a [draft proposal for an IETF RFC on OCSP Must-Staple][1].

#### Must-Staple Assertion in the SSL Header

A more immediate solution to OCSP Must-Staple would be to include the flag in an HTTP [response header][2]. [Mozilla developers][3] are currently working on this solution.

In this case, the Web administrator will add a Must-Staple response header to their Web server responses. The header will include a max-age specification, which will tell the browser that the Must-Staple flag is valid for a certain period of time. The browser will then cache the Must-Staple information.

#### Returning visits
The next time the browser goes to the website, it will know that this is a Must-Staple site. If no OCSP staple is received, then the browser will hard-fail.

This solution does have a &ldquo;first visit&rdquo; problem (i.e., Trust On First Use or TOFU). This means that until a browser has visited a site, it will not have the Must-Staple information. This would allow an attacker to interfere with the browser&rsquo;s first visit to a website. This makes the solution good, but not perfect. There is also the possibility that the attack can be mitigated using a preloaded list of Must-Staple sites.

Here is a summary of OCSP Must-Staple:

| How                                           | Definition                                                                                     | Pros                                                                                     | Cons                                                                  |
|-----------------------------------------------|------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------|-----------------------------------------------------------------------|
| **OCSP Must-Staple (assertion in certificate)**   | The flag is implemented as a specific object identifier (OID) extension in the SSL certificate | No “first visit” problem – all connections to the Web Server carry the Must-Staple flag. | Web server needs a certificate issued with the OCSP Must-Staple flag. |
| **OCSP Must-Staple (assertion in HTTP Response)** | The flag is implemented as an HTTP Response Header                                             | Works with existing SSL certificate.                                                     | “First visit” problem                                                 |

OCSP Must-Staple removes most of the issues with traditional revocation checking, and allows the browsers to implement a hard-fail policy. Although there are some cons listed, these are basically items that will be resolved as the deployed browsers and Web servers support OCSP Stapling and Must-Staple.

Currently, all of the new desktop browsers support OCSP stapling. Regarding Web servers, Microsoft IIS by default supports OCSP Stapling and versions of Apache and Nginx can be configured to support OCSP Stapling. Other servers such as F5 will soon support OCSP Stapling as well.

 [1]: http://tools.ietf.org/html/draft-hallambaker-muststaple-00
 [2]: https://en.wikipedia.org/wiki/List_of_HTTP_header_fields
 [3]: https://wiki.mozilla.org/CA:ImprovingRevocation#OCSP_Must-Staple