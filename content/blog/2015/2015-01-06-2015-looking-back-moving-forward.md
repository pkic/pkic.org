---
authors:
- Bruce Morton
date: "2015-01-06T16:30:28+00:00"
dsq_thread_id:
- 3392720280
keywords:
- tls
- tls 1.2
- tls 1.3
- ietf
- vulnerabilities
- caa
- ev certificate
- ssl 3.0
- mitm
- mozilla
- apple
- tls 1.0
- rsa
- malware
- firefox
- pki
- ca/browser forum
- chrome
- ssl
- code signing
- https
- vulnerability
- google
- microsoft
- sha1
- attack
- policy
- openssl
- forward secrecy
tags:
- SSL/TLS
- TLS 1.2
- TLS 1.3
- IETF
- Vulnerability
- CAA
- EV
- SSL 3.0
- MITM
- Mozilla
- Apple
- TLS 1.0
- RSA
- Malware
- Firefox
- PKI
- CA/Browser Forum
- Chrome
- Code Signing
- Google
- Microsoft
- SHA1
- Attack
- Policy
- OpenSSL
- Forward Secrecy
title: 2015 – Looking Back, Moving Forward


---
### Looking Back at 2014

## End of 1024-Bit Security

In 2014, the SSL industry moved to issuing a minimum security of 2048-bit RSA certificates. Keys smaller than 2048 are no longer allowed in server certificates. In addition, Microsoft and [Mozilla started][1] to remove 1024-bit roots from their certificate stores. Hopefully, the key size change will support users through to 2030.

## Push to Perfect Forward Secrecy

Following the Edward Snowden revelations of pervasive surveillance, there was a big push to configure web servers to support [Perfect Forward Secrecy][2]. For the most part, this is a reconfiguration of the ciphers to prefer those that support [Diffie-Hellman Ephemeral (DHE)][3]. With perfect forward secrecy, a compromise of the server private key will not allow secured communications to be decrypted.

## TLS Stack Issues

In 2014, issues were found with all TLS stacks and created some new stack versions.

Apple had the [Goto Fail bug][4] where the certificate was not authenticated which could lead to a man-in-the-middle (MITM) attack.

GnuTLS, used in products such as Red Hat desktop/server and Debian and Ubuntu Linux distributions, also had an issue with [improperly verifying digital certificates as authentic][5]. The vulnerability allows an attacker to impersonate a trusted site and create a certificate that would be accepted by a user.

OpenSSL followed up with a security issue coined [Heartbleed][6]. With Heartbleed, an attacker could read the memory of the web server which may reveal the private key or end user passwords or data. [XKCD depicted the issue quite nicely][7].

[NSS crypto library had the BERserk bug][8] ,which impacted Mozilla products such as Firefox and Google Chrome. This vulnerability allows for attackers to forge RSA signatures and bypass authentication to SSL protected websites. Users on a compromised network could reveal passwords or download malware.

Microsoft completed the set with revealing a [bug to Schannel later dubbed WinShock][9]. This vulnerability grants code execution where an application such as Internet Explorer may be triggered by a component outside the protected environment. In the case of client targeted attack, it is easy to achieve control during normal browser exploitation which raises its severity.

The good news is that OpenBSD and Google are trying to raise the security of the TLS stacks by preparing their own versions. [OpenBSD developed LibreSSL][10] which is a cut-down version of OpenSSL. OpenBSD has tried to simplify by eliminating old code which supports legacy platforms.

Google also announced its version of OpenSSL called [BoringSSL][11]. Google is striving to keep SSL boring by deploying HTTPS without bugs.

## Google SHA-1 Deprecation

[Google advanced the schedule of SHA-1 deprecation][12]. The industry was already working to the [policy implemented by Microsoft][13] where the certification authorities (CAs) would stop signing with SHA-1 in 2016 and Windows would stop supporting SHA-1 in 2017. Google supports the policy, but has also decided to provide warning indicators in Chrome as early as 2014 for SHA-1 signed certificates which will expire in 2016 or later. As a result, the CAs advanced communications to certificate customers to accelerate the migration to SHA-2.

## POODLE

Google also announced the [POODLE vulnerability][14]. With POODLE, an attacker can downgrade the SSL/TLS session to SSL 3.0. Once SSL 3.0 has been agreed, then through a padding oracle attack, it will allow items such as “secure” HTTP cookies or HTTP authorization header contents to be stolen. The result was the ability to use SSL 3.0 was removed from many servers and browsers. In addition, some servers were patched to prevent the fallback to SSL 3.0.

It was later revealed [POODLE could also be used against the TLS versions of the protocol][15]. In this case, padding was performed incorrectly in about 10 percent of the web servers. The impacted server vendors then had to release patches to mitigate POODLE.

### To 2015 and Beyond

## [Certificate Transparency (CT)][16]

Early in 2014, [Google announced Chrome would start supporting CT for EV SSL certificates in 2015][17]. As a result, the CAs advanced their schedules and have implemented CT for all new EV SSL certificates. To support existing EV certificates, the CAs have provided these to Google which will be whitelisted for Chrome. As such, all EV certificates should be publicly logged in 2015.

The public logging will allow monitoring to be developed. Monitoring will provide domain owners the chance to see when an EV certificate has been issued with their domain. Moving forward we will see CT progressed through the IETF and a new RFC released sometime in the future. We may also see CT extended to support DV and OV SSL certificates.

## [Certification Authority Authorization (CAA)][18]

The CA/Browser Forum has implemented a change to the SSL Baseline Requirements to require all CAs to [disclose their policy on CAA by April 2015][19]. Implementation of CAA will allow domain owners to specify their CA through DNS or DNSSec.

## Code Signing Baseline Requirements

The CA/Browser Forum has advanced the development of the Code Signing Baseline Requirements. The draft requirements were provided for [public review in the fall of 2014][20]. The requirements will be updated and submitted for approval in 2015. The baseline requirements will provide direction to mitigate threats, such as private key protection, identity verification and threat detection.

## Certificate Validity Limited to 39 Months

As of April 1, 2015, the maximum validity period of non-EV SSL certificates will be limited to 39 months as specified in the CA/Browser Forum SSL Baseline Requirements. The Baseline Requirements do allow for some exceptions where 60 month certificates can be issued. The reduction of validity periods will allow certificates with old requirements to expire on a timelier basis which will promote the web server to be upgraded with certificates that meet the latest requirements.

## Stop Using Non-Registered Domains

As per the SSL Baseline Requirements, public trusted certificates with non-registered domain names will no longer be issued as of November 1, 2015. Any certificates with non-registered domain names that are still valid must be revoked by October 1, 2016.

Subscribers using these certificates are encouraged to change their systems to support registered domain names. If this is not possible, then consider using a dedicated CA or a service from a CA vendor with private trust. More information can be found in the [CA Security Council whitepaper][21].

## TLS 1.3

With the POODLE elimination of SSL 3.0 and the vulnerabilities of TLS 1.0 and 1.1, the best implementation of the SSL/TLS protocol is TLS 1.2. So what’s next? [TLS 1.3 is on the horizon][22].

Hopefully in 2015 we will see the release of TLS 1.3 which will allow browser and server vendors to implement. We will also want to push for TLS 1.3 deployment in order to mitigate an attack against TLS 1.2.

 [1]: https://www.entrust.com/root-certificates-1024-bit-rsa-keys-removed/
 [2]: https://casecurity.org/2014/04/11/perfect-forward-secrecy/
 [3]: https://en.wikipedia.org/wiki/Diffie%E2%80%93Hellman_key_exchange
 [4]: https://www.entrust.com/apple-ssl-bug-vulnerable-2/
 [5]: http://threatpost.com/gnutls-certificate-verification-flaw-exposes-linux-distros-apps-to-attack/104614
 [6]: https://casecurity.org/2014/04/09/heartbleed-bug-vulnerability-discovery-impact-and-solution/
 [7]: https://xkcd.com/1354/
 [8]: http://www.darkreading.com/attacks-breaches/berserk-bug-uncovered-in-mozilla-nss-crypto-library-impacts-firefox-chrome/d/d-id/1316080
 [9]: http://www.cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2014-6321
 [10]: http://www.libressl.org/
 [11]: https://www.imperialviolet.org/2014/06/20/boringssl.html
 [12]: https://casecurity.org/2014/09/24/google-plans-to-deprecate-sha-1-certificates-updated/
 [13]: http://blogs.technet.com/b/pki/archive/2013/11/12/sha1-deprecation-policy.aspx
 [14]: https://casecurity.org/2014/11/21/a-follow-up-on-poodle-and-ssl-3-0/
 [15]: https://casecurity.org/2014/12/16/poodle-for-tls/
 [16]: https://casecurity.org/2013/09/09/what-is-certificate-transparency-and-how-does-it-propose-to-establish-certificate-validity/
 [17]: http://www.certificate-transparency.org/ev-ct-plan
 [18]: https://casecurity.org/2013/09/25/what-is-certification-authority-authorization/
 [19]: https://cabforum.org/2014/10/14/ballot-125-caa-records/
 [20]: https://cabforum.org/2014/08/25/cabrowser-forum-releases-code-signing-baseline-requirements-public-comment-draft/
 [21]: /uploads/2013/04/Guidance-Deprecated-Internal-Names.pdf
 [22]: https://tools.ietf.org/html/draft-ietf-tls-tls13