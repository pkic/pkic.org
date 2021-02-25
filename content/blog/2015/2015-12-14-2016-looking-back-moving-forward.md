---
authors:
- Bruce Morton
date: "2015-12-14T19:53:24+00:00"
dsq_thread_id:
- 4403870208
keywords:
- google
- microsoft
- attack
- policy
- rc4
- openssl
- encryption
- tls
- tls 1.3
- tls 1.2
- dh
- ietf
- vulnerabilities
- caa
- revocation
- md5
- mitm
- rsa
- firefox
- ca/browser forum
- chrome
- ssl
- code signing
- vulnerability
tags:
- Google
- Microsoft
- Attack
- Policy
- RC4
- OpenSSL
- Encryption
- SSL/TLS
- TLS 1.3
- TLS 1.2
- DH
- IETF
- Vulnerability
- CAA
- Revocation
- Hash Function
- MITM
- RSA
- Firefox
- CA/Browser Forum
- Chrome
- Code Signing
title: 2016 – Looking Back, Moving Forward


---
## Looking Back at 2015

A number of new tactics proved 2015 was no exception to an active year defending against ever increasing security issues. Vendors found new and creative ways to provide vulnerabilities including the now popular man-in-the-middle (MitM) attacks.  MitM as well as a host of other new vulnerabilities caused browsers to rethink their security requirements.  This article gives a flashback of the exploits and industry changes from 2015 and looks ahead at the latest security requirements and how it impacts IT security teams.

## Man-In-The-Middle

2015 was the year of the MitM vulnerability, which started in [January with Gogo][1]. Gogo provides Wi-Fi capabilities to airline passengers. Gogo likes to control the bandwidth and wants to stop passengers from downloading large files such as movies; however, Gogo cannot tell what the content is for encrypted traffic. As such, Gogo intercepts the traffic using their own MitM server, which decrypts the traffic and then bandwidth controls can be used. Their certificate is untrusted, which makes the passenger accept a session with an error. This is not a best practice to train users to accept errors.

[Lenovo provided the MitM vulnerability on its PCs][2]. They used an application called Superfish to enable their adware application to deliver content transparently. Where the session is encrypted, Superfish issues a certificate to MitM the session. The certificate is trusted, because the root certificate was installed on the PC before shipping from Lenovo. To add to the vulnerability, all root certificates use the same private key, which is also bundled onto the PC. The private key was easily hacked, which would allow attackers to sign certificates which many Lenovo users would trust.

It was also discovered [PrivDog may pose a bigger risk than Superfish][3]. PrivDog also supports MitM for adware, but in the PrivDog case, it does not validate the site certificate. As such the browser user may connect to a site with an untrusted certificate.

[CNNIC mistakenly issued a certification authority (CA) certificate][4] to a customer. As such the private key could be used to issue certificates which would be trusted for most browsers. Again, this type of certificate could be used for a MitM attack. Due to the actions of CNNIC, Google decided that Chrome would not trust any new certificates unless they were logged with Certificate Transparency. Mozilla took a tougher action, as Firefox now distrusts CNNIC certificates issued after April 1, 2015.

In November, it was discovered that [Dell had installed two root certificates on its PCs][5], including the private key. These roots were installed in Windows and would be trusted by all applications using Windows for security. Again, there was an opportunity to attack the private keys and an attacker could be able to issue a MitM certificate. Microsoft took action to remove trust from these roots.

MitM is a vulnerability which operating system and browser vendors need to take proactive action. There should be consideration of removing trust for all roots which have not been approved by the browser/OS trust program.

## Live.fi

Some hacks are better to be done more than once. A few years ago a researcher obtained a certificate for the Microsoft owned domain live.com. This year another attack was performed to [obtain live.fi][6]. The attack was performed by sending an email to an approved email address included in the CA/Browser Forum Baseline Requirements. However, the attacker was also able to enroll for the same email address, which allowed him to approve the use of the domain.

Domain owners should have a naming policy for email addresses and should assign or reserve email addresses starting with ‘admin’, ‘administrator’, ‘webmaster’, ‘hostmaster’ or ‘postmaster’.

## Export Cipher Vulnerabilities

There were two vulnerabilities discovered related to allowed lower level crypto called FREAK and Logjam. These vulnerabilities date back to the 1990s, when the US government banned selling crypto software overseas, unless it used export cipher suites which involved encryption keys no longer than 512-bits.

[FREAK (Factoring RSA-EXPORT Keys)][7] is a vulnerability where the browser can ask to use export grade RSA in the TLS handshake. This allows a MitM attacker to intercept communications and complete the communication with export level RSA. The export level key is easy to attack, which would then allow communication to be reviewed or changed. Server administrators can mitigate FREAK by disallowing export keys on their servers.

[Logjam][8] allows a MitM attacker to ask for a Diffie-Hellman prime that is less than the browser asked for. The server accommodates the falsified request and sends the 512-bit, 768-bit, 1024-bit, or whatever length prime was requested. This can allow the attacker to break the weak cryptography. Administrators should disable export cipher suites and increase the number of bits used by the prime numbers in the Diffie-Hellman key exchange to 2048 bits.

## HTTP/2

[HTTP/2][9], the next version of HTTP was approved in February 2015. The goals of HTTP/2 include improving performance, compatibility with HTTP/1.1, and interoperability with HTTP/1.1. The biggest change with HTTP/2 is that it is multiplexed, which means that one network connection can serve requests for many pieces of content at the same time. This reduces time to load pages and makes better use of network resources.

Although HTTP/2 standard does not require SSL/TLS to implemented, the use of HTTP/2 will be more secure. The reason is support of HTTP/2 by Google, Mozilla and Microsoft requires SSL/TLS.

## OpenSSL Certificate Verification Flaw

It was discovered in June 2015 that [OpenSSL had a high severity vulnerability][10] with certificate verification. During certificate verification, OpenSSL will attempt to find an alternative certificate chain, if the first attempt to build a chain fails. An error in the implementation of this logic can mean that an attacker could cause certain checks on untrusted certificates to be bypassed, such as the CA flag, enabling them to use a valid leaf certificate to act as a CA and issue an invalid certificate. This means that an attacker can then become trusted the same as a certification authority (CA) and issue invalid publicly trusted SSL/TLS certificates for any domain. Administrators are encouraged to maintain a practice to continue to upgrade their servers to avoid such issues.

## Certificate Transparency

In 2015, Google required that all EV certificates support [certificate transparency (CT)][11]. This means that all new EV certificates are logged to a CT log. All old unexpired EV certificates have been whitelisted for CT in Chrome. The result is that the CT logs can now be monitored to determine which domains EV certificates have been issued for. This allows domain owners to monitor the logs to help them protect their domains. It is expected as CT is supported with many logs and IETF improves the standard, that it will later be deployed for all SSL/TLS certificates.

## Certification Authority Authorization

In April 2016, all CAs were required to disclose their [Certification Authority Authorization (CAA)][12] policy in their certification practice statements. The benefit of CAA is a domain owner can state in their DNS records which CA is authorized to issue certificates for that domain. Implementation of CAA is not a mandatory requirement, but now the public will know how each CA supports CAA.

## Certificate Validity limited to 39 months

Starting in April 2015, the maximum validity period of SSL/TLS certificates was [reduced from 60 months to 39 months][13]. This essentially allows certificate subscribers to purchase 3 year certificates. The extra 3 months can be used to cover the migration period as subscribers move from an old certificate to a new certificate. The benefit of shorter certificate lifetimes is that the key pair can be updated in a shorter period and that old cryptography measures can be updated when the certificate is renewed.

## Internal Certificate and Non-Registered Domains

In November 2015, [CAs stopped issuing public trust SSL/TLS with domains which were not registered][14]. This would include names such as:

  * Host name only, _casecurity_
  * Name using reserved TLD, _local_
  * Name using undefined TLD, _casc_
  * Reserved IP address, _0.0.1_

This policy will mitigate attacks where public CAs issue certificates for “internal” names as documented in this [whitepaper][15]. Certificate subscribers are encouraged to change their domain names to registered names. If this is not possible, then SSL/TLS certificates will have to be self-signed, issued from an enterprise CA or issued from a private trust service.

## To 2016 and Beyond

## SHA-2 Only

2015 will see the end of the issuance of public trusted SHA-1 signed certificates. As of January 1, 2016 all SSL/TLS certificates must be signed using SHA-2. Moving to SHA-2 will mitigate the chance of a collision attack on a SHA-1 signed certificate. This attack would mostly likely happen at time of issuance as was shown by [previous hash attacks on MD5][16].

Valid SHA-1 signed certificates will be allowed to expire; however, Chrome already shows errors for SHA-1 signed certificates which expire after 2015 and Windows will not support SHA-1 signed certificates in 2017.

## Code Signing Baseline Requirements

The CA/Browser Forum has finished the [Code Signing Baseline Requirements][17] and has balloted for implementation. If the ballot passes, the Code Signing BRs will be effective October 1, 2016. The new requirements will impose standards to better protect private keys, implement improved subscriber validation and require new revocation policies.

## RC4 and DHE

Server operators will have to stop using or deprecate the use of RC4 and DHE inn their cipher suites. With attacks on RC4 and DHE, browser vendors such as Google are planning to make browser changes to stop supporting RC4 and DHE. Administrators are encouraged to continue to implement TLS 1.2 and cipher suites which support this version of the protocol.

## TLS 1.3

[TLS 1.3][18], the new version of the TLS protocol is near completion. TLS 1.3 will improve security with changes such as:

  * Remove support for weak and lesser used named elliptic curves
  * Remove support for MD5 and SHA-224
  * Requiring digital signatures
  * Dropping support for insecure, obsolete features including compression, renegotiation, non-AEAD ciphers and static RSA or DH key exchange
  * Prohibit SSL and RC4 negotiation for backwards compatibility

It is hoped that browser, server and application vendors will move quickly to TLS 1.3 implementation to be prepared for future TLS migration.

IT security teams will have to remain vigilant of emerging threats while moving quickly to meet the new minimum requirements set forth by browsers and the CA/Browser Forum.

 [1]: https://casecurity.org/2015/01/08/gogo-found-spoofing-google-ssl-certificates/
 [2]: https://casecurity.org/2015/02/20/lenovo-enables-man-in-the-middle-attacks-via-superfish-adware/
 [3]: https://threatpost.com/privdog-poses-bigger-risk-than-superfish/111211/
 [4]: https://casecurity.org/2015/04/02/fighting-the-good-fight-for-online-trust/
 [5]: http://en.community.dell.com/dell-blogs/direct2dell/b/direct2dell/archive/2015/11/23/response-to-concerns-regarding-edellroot-certificate
 [6]: https://www.entrust.com/what-happened-with-live-fi/
 [7]: https://casecurity.org/2015/03/11/is-your-ssl-server-vulnerable-to-a-freak-attack/
 [8]: https://casecurity.org/2015/05/26/practical-steps-to-counter-the-logjam-attack/
 [9]: https://casecurity.org/2015/04/20/http2-is-speedy-and-secure/
 [10]: https://casecurity.org/2015/07/10/openssl-high-severity-vulnerability/
 [11]: https://casecurity.org/2013/09/09/what-is-certificate-transparency-and-how-does-it-propose-to-establish-certificate-validity/
 [12]: https://casecurity.org/2013/09/25/what-is-certification-authority-authorization/
 [13]: https://casecurity.org/2015/02/19/ssl-certificate-validity-periods-limited-to-39-months-starting-in-april/
 [14]: https://casecurity.org/2014/07/18/what-to-do-when-you-rely-on-internal-names-in-tlsssl-certificates/
 [15]: /uploads/2013/04/Guidance-Deprecated-Internal-Names.pdf
 [16]: https://en.wikipedia.org/wiki/MD5#Collision_vulnerabilities
 [17]: https://casecurity.org/2015/11/30/code-signing-baseline-requirements-2/
 [18]: https://en.wikipedia.org/wiki/Transport_Layer_Security#TLS_1.3