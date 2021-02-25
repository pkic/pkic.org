---
authors:
- Bruce Morton
date: "2017-01-13T21:11:15+00:00"
dsq_thread_id:
- 5460572678
keywords:
- tls
- tls 1.3
- 3des
- vulnerabilities
- caa
- time-stamping
- revocation
- ssl 3.0
- mitm
- apple
- rsa
- malware
- firefox
- ca/browser forum
- cps
- chrome
- ssl
- code signing
- https
- identity
- vulnerability
- google
- attack
- policy
- encryption
tags:
- SSL/TLS
- TLS 1.3
- 3DES
- Vulnerability
- CAA
- TSA
- Revocation
- SSL 3.0
- MITM
- Apple
- RSA
- Malware
- Firefox
- CA/Browser Forum
- Policy
- Chrome
- Code Signing
- Identity
- Google
- Attack
- Encryption
title: 2017 – Looking Back, Moving Forward


---
### Looking Back at 2016

Fortunately, 2016 was not a year full of SSL/TLS vulnerabilities. Although some researchers did prove old cryptography algorithms should be put out to pasture. The year showed the end of public-trusted SHA-1 SSL/TLS certificates. It also showed more transparency should be considered due to issues discovered with a few certification authorities (CAs). The great news is HTTPS is no longer the minority — after 20 years, connections using [HTTPS has surpassed HTTP][1].

## Vulnerabilities

Researchers terminated the use of the SSL 2.0 version of the protocol after a vulnerability called Decrypting RSA with Obsolete and Weakened eNcryption; otherwise known as [DROWN][2] was discovered. The vulnerability takes advantage of SSL 2.0’s weak anti-Bleichenbacher countermeasure and weak export ciphers. The attack can be performed in about 8 hours for a cost of about $440 on Amazon EC2. Administrators should not support SSL 2.0 (or SSL 3.0) on your servers.

[HEIST][3] was announced, which allows known compression-based attacks such as BREACH and CRIME to be performed directly in the browser with no network access required. The vulnerability is easier to implement because a man-in-the-middle (MitM) position is not required. HEIST is based on the fact that SSL/TLS encryption will leak data through compression. This attack would most likely be implemented through the use of third-party cookies. Site operators should ensure they trust their third-party content.

INRIA announced [SWEET32][4], birthday attack on 64-bit block ciphers in SSL/TLS and OpenVPN. The name SWEET32 is a fun term named after Sweet 16, but in this case the sweet spot is the 32 GB of data used to perform the attack. Triple-DES (3DES) and Blowfish are 64-bit block ciphers that are vulnerable to these attacks. Server administrators are encouraged to prefer minimum 128-bit cipher suites. If 64-bit ciphers are used, the length of the TLS session should be limited, which can be done with TLS renegotiation or closing and starting a new session. The best action is to disable cipher suites using 3DES.

## SHA-1 Deprecation

At the start of the year, CAs were required to stop signing public-trust SSL/TLS certificates using the SHA-1 hashing algorithm. There were a few exceptions, but these were required to support many client platforms which could not be upgraded. Netcraft shows in January 2017 that only 1.0-percent of over 13 million certificates found in their survey use SHA-1. Although there are some legacy cases where SHA-1 is still required, this has been addressed by CAs providing certificates with private trust. Private trust means the root certificates will have to be distributed by the certificate subscriber, but it does mitigate the risk for all browser and operating systems of a SHA-1 attack.

[Moving into 2017][5], the browsers will start to show more errors with certificates signed using SHA-1. Google will remove trust from public trusted SHA-1 certificates with Chrome 56 and with private trust certificates with Chrome 57. Mozilla will show an untrusted connection error in Firefox 51 to be released in January. Microsoft will release an update to Edge and Explorer 11 on February 14th to show an invalid certificate warning. We also assume Apple will push Safari in the same direction.

## Revocation of Certificates with Non-registered Domain Names

Finally, the time of public trust certificates with unregistered domain names has come to an end. As of October 1, 2016 all certificates with domains that have a hostname only, using a reserved or non-registered TLD or using a reserved IP address have been revoked. This is the end of a five-year program to mitigate this [vulnerability with internal names and reserved IP addresses][6].

## WoSign and Startcom

Affiliate CAs, [WoSign and Startcom had some issues in 2016][7]. WoSign was caught backdating certificate issuing dates to meet the SHA-1 deprecation requirements. WoSign also purchased Startcom without disclosure to the browsers or the CA/Browser Forum. Through analysis using certificate transparency (CT), Mozilla determined certificate issues and removed trust from new certificates issued by WoSign and Startcom. Apple and Google also made similar conclusions. The result seems to be the browser requirement to increase the use of CT to monitor all certificates issued by CAs.

## HTTPS – More than Half-way There

Mozilla telemetry and Google transparency report shows that after 20 years, HTTPS is used more than HTTP. Growth in HTTPS has come from the large push to move to Always-On SSL or HTTPS Everywhere. This has also been [encouraged by the browsers][8] by requiring HTTPS to be used for HTTP/2 deployment, and browser privileged services such as geolocation, device motion/orientation and encrypted media extension (EME). Many corporations, such as Blogspot, Reddit, Flickr, Wikimedia, WordPress, Bitly and Shopify, have set their default to HTTPS. The result should be a more secure Internet, greater privacy and new policies to push HTTPS to 100-percent.

### To 2017 and Beyond

In 2017, we will see more progress with SSL/TLS. Chrome will show “Not secure” on some sites and CT will be implemented for most new certificates. We may also see new requirements for CAA and the start of TLS 1.3. Code signing will also be improved with the deployment of a new standard for minimum requirements.

## Deprecation

Over the last six years we have been deprecating the old standards. With the deployment of EV SSL certificates, there was a plan to move from 1024-bit to 2048-bit RSA by the end of 2010. This deprecation was moved to non-EV certificates and 1024-bit was deprecated for all SSL/TLS certificates by the end of 2013.

EV also established a 27-month certificate validity maximum, but for non-EV certificates, there was no maximum. With the release of the Baseline Requirements, the maximum was set to 60 months, then reduced to 39 months. Shorter validity periods will allow [certificates to expire][9] and be upgraded to new standards.

Finally, we started deprecating the SHA-1 hashing algorithm in 2013. As stated above, the CAs stopped signing with SHA-1 at the end of 2016 and in 2017 the browsers will show trust issues with SHA-1 signed certificates.

The good news is that we have moved through all of the foreseen deprecation. Since 2048-bit RSA and SHA-256 are acceptable to 2030, hopefully the industry won’t put certificate subscribers through similar changes they have seen over the last six years.

## Minimum Requirements for Code Signing Certificate

Over the last few years, the browsers and the CAs have worked to document the Minimum Requirements for Code Signing. The [new standard defines requirements][10] for identity verification, protecting private keys, mitigating key compromise, certificate revocation and time-stamping. To push forward, Microsoft has made the standard the requirement for all new non-EV code signing certificates starting February 1, 2017. Minimum requirements for code signing will mitigate the signing of malware and other suspect code. It will also put in provisions to ensure certificates used to validate suspect code will be revoked in a prompt manner.

## Not Secure

Google will start to discourage website visitors from using unprotected sites by [indicating “Not secure”][11] in the status bar. Chrome 56 to be launched in January will indicate “Not secure” for a site that presents password and credit card fields that is not secured by an SSL/TLS certificate. Site operators should consider this to be an early warning as Google will plan to use “Not secure” with a red triangle for all HTTP pages in the future.

## Certificate Transparency for All Certificates

For the last two years, the CAs have been supporting CT logging for EV certificates. [Google has announced][12] CT logging will be required for all new SSL/TLS certificates as of October 2017. If there is no CT logging, Chrome will not trust the certificate.

The benefit of CT is domain names with certificates can be protected by searching the logs for unauthorized certificates. In addition, the CA issuance of certificates will be more transparent. This will allow researchers to investigate the certificate quality and compliance to industry requirements.

The downside is there may be privacy issues. Some certificates are issued for internal websites. The domain names are not publicly known; nor is the use of the website which may be determined by the host name. If domain owners want to keep their domain names private, they should consider:

  * Not logging to CT and accept losing trust from Chrome
  * Issue a wildcard certificate, which will mask the hostname
  * Issue a private trust certificate, which does not need to be logged

## Certification Authority Authorization (CAA) Standards

A CAA record is a statement in DNS that authorizes a CA or many CAs to issue certificates for a domain name. CAA has had limited deployment in the SSL/TLS industry. The CA/Browser Forum is considering adding a CAA policy to the SSL Baseline Requirements that will require all CAs to respect CAA records. Exceptions for issuing certificates irrespective of the CAA record must be documented in the CPS. The CA/Browser Forum is working on a list of acceptable reasons to allow exceptions.

For those considering to add a CAA record, they should ensure the CAA record supports all CAs that issue certificates for your current domain names. A review of CT Log entries may show the use of CAs that you were not aware.

## TLS 1.3

Be on the lookout for [TLS 1.3][13]. This version of the TLS protocol will be a great improvement to increase security and mitigate known issues. Unfortunately, the standard for TLS 1.3 has yet to be approved. Hopefully TLS 1.3 will be launched in 2017.

Looking back at 2016 we see that it was not without complication and challenges to keep up with the changing needs of achieving website security. Looking ahead we see that more needs to be done to ensure a safe, seamless experience for website users and the brands that need to secure their transactions.

 [1]: https://nakedsecurity.sophos.com/2016/10/18/halfway-there-firefox-users-now-visit-over-50-of-pages-via-https/
 [2]: https://casecurity.org/2016/04/04/ssl-2-0-and-drown/
 [3]: http://arstechnica.com/security/2016/08/new-attack-steals-ssns-e-mail-addresses-and-more-from-https-pages/
 [4]: https://casecurity.org/2016/09/07/how-a-sweet32-birthday-attack-is-deployed-and-how-to-prevent-it/
 [5]: https://nakedsecurity.sophos.com/2016/11/23/its-the-final-countdown-for-sha-1-ssl-certificates/
 [6]: /uploads/2013/04/Guidance-Deprecated-Internal-Names.pdf
 [7]: https://casecurity.org/2016/11/11/trust-on-the-public-web-the-consequences-of-covert-action/
 [8]: https://casecurity.org/2016/11/21/the-web-is-moving-from-http-to-https/
 [9]: https://casecurity.org/2016/10/19/why-is-certificate-expiration-necessary/
 [10]: https://gigaom.com/2017/01/05/castandards2017/
 [11]: https://casecurity.org/2016/09/15/chrome-to-show-http-sites-as-not-secure/
 [12]: https://casecurity.org/2016/11/08/google-certificate-transparency-ct-to-expand-to-all-certificates-types/
 [13]: https://en.wikipedia.org/wiki/Transport_Layer_Security#TLS_1.3