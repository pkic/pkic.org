---
authors:
- Bruce Morton
date: "2018-01-06T14:31:22+00:00"
dsq_thread_id:
- 6395462745
keywords:
- roca
- tls
- tls 1.3
- ov certificate
- caa
- elliptic curve
- rsa
- pki
- ca/browser forum
- chrome
- ssl
- mis-issued
- https
- vulnerability
- google
- microsoft
- attack
- encryption
- certificate expiry
- pdf
tags:
- ROCA
- SSL/TLS
- TLS 1.3
- OV
- CAA
- ECC
- RSA
- PKI
- CA/Browser Forum
- Chrome
- Mis-issued
- Vulnerability
- Google
- Microsoft
- Attack
- Encryption
- Certificate Expiry
- PDF
title: 2018 – Looking Back, Moving Forward


---
## Looking Back at 2017

2017 saw the end of SHA-1 in public trust SSL/TLS certificates and the start of Certification Authority Authorization (CAA) allowing domain owners to authorize their CA. A “Not secure” browser indication was propagated to push more websites to support HTTPS. There was also a change in the certification authority (CA) ownership with DigiCert acquiring Symantec’s SSL and related PKI business and Francisco Partners buying Comodo’s CA.

## Vulnerabilities

Google and CWI announced [SHAttered][1], an attack on the SHA-1 cryptographic hash function. The attack was demonstrated by allowing the cryptographic signature on a good PDF to be the same as on a bad PDF. In other words, they forged the signature. Fortunately, this attack should not impact SSL/TLS as CAs have not issued SHA-1 certificates since 2015 and browsers stopped supporting SHA-1 in 2017.

[Return of Coppersmith’s Attack (ROCA)][2] is a vulnerability in the generation of RSA keys used by a software library adopted in cryptographic smartcards, security tokens and other secure hardware chips. ROCA was found in a cryptographic library used in a wide range of cryptographic chips produced by Infineon Technologies AG. The vulnerability was disclosed to Infineon in the first week of February with an agreement to an 8 month period before public disclosure. Major vendors including Microsoft, Google, HP, Lenovo and Fujitsu released the software updates and guidelines for mitigation. A scan of certificate transparency logs showed that few SSL/TLS certificates were impacted.

The [Return Of Bleichenbacher’s Oracle Threat (ROBOT) attack][3] was announced at the end of 2017. ROBOT is a 19-year-old vulnerability that allows performing RSA decryption and signing operations with the private key of an SSL/TLS server. ROBOT only affects SSL/TLS cipher modes that use RSA encryption. Most modern SSL/TLS connections use an Elliptic Curve Diffie Hellman key exchange and need RSA only for signatures. It is recommended that RSA encryption modes be disabled.

## SHA-1 Deprecation

Starting in January of 2017, browsers and operating systems stopped supporting SSL/TLS certificates signed using the SHA-1 hashing algorithm. This impacted many websites that were not moved to SHA-2 preemptively.

## Not Secure

In January 2017, Chrome 56 started to indicate “Not secure” for websites that present password and credit card fields that are not protected by HTTPS. In October 2017, through Chrome 62, the “Not secure” warning was extended to include any non-HTTPS page that accepts data from website visitors. In addition, these pages will also show “Not secure” when visited by users in Chrome Incognito mode to protect these users who are considered to use this mode as a security baseline. Website operators should consider these to be early warnings that Google Chrome will plan to use “Not secure” for all HTTP pages in the future.

Firefox also supports “Not secure.” For HTTP sites which support text input or not, there is a “!” displayed with a drop down stating “Connection is Not Secure.” For HTTP sites which allow passwords, logins or credit cards, the warning is escalated to show a lock with a strike-through and the similar “Connection is Not Secure” drop down.

## Certification Authority Authorization (CAA)

As of September 2017, [all CAs must check CAA records before issuing a certificate][4]. With CAA, a domain owner can:

  * Authorize one or many CAs to issue certificates
  * Not allow any CA to issue a certificate
  * Allow or disallow a wildcard certificate to be issued
  * Provide contact information to suggest a CAA record be updated or report security issues

If the CAA record does not permit the CA to issue a certificate, then the certificate request will fail.

CAA allows domain owners to state their security rules, which all CAs must follow. As a result, the domain owner can use CAA as a preventative measure to mitigate the vulnerability of an attacker getting a certificate from an unauthorized CA. CAA can also enforce compliance for all employees to purchase certificates from a preferred CA.

## Domain Name Validation

In October 2017, the CA/Browser Forum rolled out a complete set of updated domain name validation rules. The new roll out eliminated the option for a CA to use “any other method of confirmation,” and replaced it with four new agreed upon methods. The change has also raised the security level of old and new validation methods. The result is the CAs now have a total of 10 standard methods to validate domains. These methods can be used for DV, OV and EV certificates. For more information, see [Baseline Requirements][5] section 3.2.2.

## Public Key Pinning is No Longer Recommended

Public Key Pinning was a great idea at first. Google used static public keys to protect their websites. In doing so, the keys were embedded in Chrome and were useful in helping users find the DigiNotar attack in 2011, and in a mistaken CA certificate issued by TURKTRUST in 2012.

The success of public key pinning resulted in RFC 7469 being produced allowing for dynamic HTTP Public Key Pinning (HPKP) which could be deployed by all website administrators. Unfortunately, HPKP is far too complicated to deploy and too easily bricks your site for a long period. It was not highly recommended to be deployed and now [Google plans to deprecate then remove support for HPKP][6] in Chrome.

## To 2018 and Beyond

In 2018 look forward to measures that tighten security protocols for SSL/TLS certificates. Shorter validity periods for OV and DV certificates more quickly root-out unwanted certificates while CT logging for OV and DV certificates will expand an organization’s ability to monitor certificate issuance.  Will TLS 1.3 finally see the light of day?

## 825-day Certificate Expiry Period

As of March 1, 2018, the following changes will be made:

  * DV and OV certificate validity periods will be reduced from 39 months to an 825-day maximum
  * EV certificate validity period will be changed from 27 months to an 825-day maximum
  * Reuse of information to validate DV and OV certificates will be reduced from 39 months to 825 days. Please note that reuse of information to validate EV certificates will remain at 13 months.

The goal of reducing the certificate lifetime is to force certificates to be changed more frequently. More frequent changes will:

  * Reduce the number of certificates using older cryptographic standards; for example moving from 1024 to 2048-bit RSA key length or moving from SHA-1 to SHA-2 hashing algorithm
  * Mitigate certificates that are non-compliant with the [CA/Browser Forum Baseline Requirements or EV Guidelines][7]
  * Minimize active certificates issued due to fraudulent requests and activities
  * Expire mis-issued certificates more rapidly
  * Expire certificates with information that has been verified to older standards

The result will be that old SSL/TLS certificates will expire sooner and have less impact on the SSL/TLS ecosystem.

## Certificate Transparency (CT)

[In April 2018][8], Google will require all SSL/TLS certificates to be CT-logged in order to have trust in Chrome. CT logging has been deployed since the beginning of 2015 for all EV certificates. Expanding CT logging to both DV and OV certificates will enable domain owners to monitor the CT logs to detect any fraudulent certificates.

There is some concern regarding privacy based on the information in the certificate. For instance, some domains are used for internal use only, but have domain names that clearly identify how the server is used. There is also the concern that exposure of all domains is just another step to support attacks. Certificate subscribers that are concerned about exposing their domain names may consider: 1) not logging, 2) using private trust certificates or 3) using wildcard certificates.

## Transport Layer Security (TLS) 1.3

This will be the fourth time we will expect TLS 1.3 to be launched in the next year. In fact, TLS 1.3 is deemed ready. The draft RFC is in the last call stage and TLS 1.3 is already supported by [Chrome, Mozilla and Opera][9]. However, deployment of TLS 1.3 is being blocked by faulty middlebox devices that try to analyze traffic and block packets that don’t look like known protocol messages. Testing is ongoing and changes may have to be made to TLS 1.3 to reduce failure rates.

 [1]: http://shattered.io/
 [2]: https://crocs.fi.muni.cz/public/papers/rsa_ccs17
 [3]: https://robotattack.org/
 [4]: https://casecurity.org/2017/03/21/the-latest-on-certification-authority-authorization/
 [5]: https://cabforum.org/baseline-requirements-documents/
 [6]: https://groups.google.com/a/chromium.org/forum/#!msg/blink-dev/he9tr7p3rZ8/eNMwKPmUBAAJ
 [7]: https://cabforum.org/documents/
 [8]: https://casecurity.org/2017/05/03/certificate-transparency-deadline-moved-to-april-2018/
 [9]: https://caniuse.com/#feat=tls1-3