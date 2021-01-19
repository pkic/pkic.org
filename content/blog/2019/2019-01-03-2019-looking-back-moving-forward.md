---
title: 2019 – Looking Back, Moving Forward
authors: [Bruce Morton]
date: 2019-01-03T14:24:26+00:00


---
## Looking Back at 2018

2018 was an active year for SSL/TLS. We saw the SSL/TLS certificate validity period drop to 825-days and the mass deployment of Certificate Transparency (CT). TLS 1.3 protocol was finally completed and published; and Chrome status bar security indicators changing to remove “secure” and to concentrate on “not secure.” The CA/Browser Forum has been reformed, the London Protocol was announced and the nearly full distrust of Symantec SSL completed. Here are some details on some of the 2018 happenings in the SSL/TLS ecosystem.

## Vulnerabilities

The new vulnerabilities exposed in 2018 were actually quite slim. The year reminded me of the old saying “attacks always get better, they never get worse” as the Bleichenbacher attack and another man-in-the-middle attack resurfaced.

A research team released a paper, “[The 9 Lives of Bleichenbacher’s CAT: New Cache ATtacks on TLS Implementations][1].” The paper shows that most SSL/TLS implementations are still vulnerable to Bleichenbacher-like leakages through microarchitectural side channels. Simulated attacks demonstrated the feasibility of a downgrade attack which could recover all 2048 bits of the RSA plaintext including the premaster secret value, which suffices to establish a secure connection. Vulnerability mitigation can be done through using Elliptic Curve Diffie-Hellman key exchanges or using BearSSL or BoringSSL protocol implementations.

Sennheiser, an audio product company, created [a man-in-the-middle vulnerability][2] in their headsets similar to [SuperFish][3]. The headset setup software installed a “trusted” root CA certificate into the user’s workstation along with an encrypted version of the CA’s private key. The CA certificate and private key were the same for all users. A security consulting firm discovered two unknown CA certificates in the root store. Through more investigation, they were able to discover the private key and the password for decryption. The vulnerability would allow an attacker to issue certificates that would be trusted by any user that had installed the Sennheiser headset setup software.

## Trustico Certificate Revocation

Trustico, an SSL/TLS reseller, had to have [as many as 23,000 certificates revoked][4]. The situation started when Trustico reached out to DigiCert and requested to have many certificates revoked due to a compromise. When DigiCert asked for proof of the compromise, Trustico replied by email that included the 23,000 private keys. As a result, DigiCert was forced to revoke all of the certificates within 24 hours to be compliant with the CA/Browser Forum Baseline Requirements.

## 825-day Certificate Expiry Period

As of March 1, 2018, the SSL/TLS certificate expiry period has been reduced to [825-days from time of issue][5]. In addition, the period that CAs are permitted to reuse verification information for DV and OV SSL/TLS certificates has also been reduced to 825 days.

The result of a shorter expiry period will help secure the ecosystem by: removing certificates that were issued with older requirements; updating private keys at a higher rate; and expiring fraudulent and mis-issued certificates more rapidly.

## Certificate Transparency (CT)

Chrome 68 was launched in July 2018 and requires all SSL/TLS certificates issued after April 30, 2018, be published to a [minimum number of CT qualified logs][6]. Apple also [extended its CT policy][7] effective October 15, 2018. If the certificate is not CT logged, it will not be trusted by Chrome or Safari.

CT monitoring allows domain owners to search for and find all Chrome trusted certificates that have been issued to their domain. It also helps with the detection of certificates issued fraudulently. Tests against CT logged certificates also detected mis-issued certificates. These detections will drive improvements in issuing practices by CAs and will increase security in the ecosystem.

Privacy was not addressed with name redaction, so those certificate subscribers that are concerned about exposing their domain names to the public may consider: 1) not logging, 2) using private trust certificates or 3) using wildcard certificates.

## Transport Layer Security (TLS) 1.3

[TLS 1.3][8] was finalized and published in August 2018 through [RFC 8446][9]. TLS 1.3 will increase security and performance to the internet ecosystem:

  * [Forward Secrecy][10] will be supported as all cipher suites that do not support forward secrecy have been eliminated,
  * Downgrade protection will not be allowed as any claim to only support an earlier version of TLS will be rejected, and
  * Performance is increased by eliminating several round-trip messages, which is currently required to negotiate secure communication with older versions of TLS.

TLS 1.3 is already supported by [Chrome, Mozilla and Opera][11].

## Ramping up “Not secure” and Death to “Secure”

Google has been changing the way Chrome presents the browser status bar with providing a “Not secure” indicator on HTTP websites with where data entry is required; and “Secure” for those websites that are protected with HTTPS.

With Chrome release 68, “Not secure” was now provided on all HTTP sites, and with release 70 the text was changed to red and a red triangle was added.

{{< figure src="/uploads/2019/01/2019-1.png" >}} 

On the other hand, [the use of the word “Secure” has not been well accepted][12]. With the Internet moving to 100 percent HTTPS, this means that phishing attackers must also use HTTPS. So “Secure” doesn’t really mean safe. The communication between the browsers and the server is secure; however, the server may be run by an attacker. Google appears intent to remove positive security indicators and focus on negative security indicators. As a result, Google removed the “Secure” indication from the status bar in Chrome release 69.

{{< figure src="/uploads/2019/01/2019-2.png" >}} 

## CA/Browser Forum Governance Reform

The [CA/Browser Forum has reformed its organization][13]. The forum was formed in 2005 to address the race to the bottom of the validation of SSL/TLS certificates. Over 13 years, the forum has set the standard for public trust SSL certificates setting properties for domain validation (DV), organization validation (OV) and extended validation (EV). The forum also introduced EV code signing certificate standards and worked towards a baseline for code signing certificates.

The issue was the Forum also introduced intellectual property standards – this expansion in scope beyond SSL/TLS seemed to conflict with these standards. As a result, the Forum revamped the group to allow an upper CA/Browser Forum management level, plus working groups that would manage specific standards. The working groups can be formed under charters and then joined after the intellectual property rights agreement has been signed. If an organization has not joined a working group, then it is not subject to intellectual impacts of that group.

In July 2018, the Forum was “relaunched” with one working group to manage the legacy of Server Certificates. The Forum will plan to introduce other working groups to cover topics such as code signing and secure email certificates.

## The London Protocol

The CA Security Council announced at the CA/Browser Forum event in London the launch of the [London Protocol][14]. The London Protocol is an initiative to improve identity assurance and minimize the possibility of phishing activity on websites encrypted with OV and EV certificates, which contain organization identity information.

The CAs will work together and share data to:

  * Actively monitor phishing reports for websites encrypted by the CA’s own OV and EV certificates;
  * Notify the affected website owner that phishing content was found and provide remediation instructions as well as prevention methods;
  * Contribute to a common database to help reduce future phishing content. This data will be available to other participating CAs so that each CA can conduct additional due diligence before issuing new OV or EV certificates to the website; and
  * Develop a name collision system to attempt to prevent [the “Stripe” threat vector][15].

At its core, the London Protocol is designed to get back to the root of what OV and EV certificates were created for – providing online consumers better trust and assurance.

## Bye, bye Symantec SSL

In January 2017, there was [a public posting][16] which drew attention to a series of questionable website authentication certificates issued by Symantec Corporation’s PKI. After much investigation and discussion, Google announced a program to distrust the Symantec root certificates. The outcome was Symantec SSL business was sold to DigiCert, where DigiCert had to attempt to issue subscribers certificates under the DigiCert root certificates.

Google has distrusted Symantec in stages and as of Chrome release 70 in October 2018, all certificates issued under a Symantec root have been distrusted. Other browsers and application vendors have also created a schedule of distrust: [Apple][17], [Microsoft][18], [Mozilla][19] and [Oracle][20].

## Domain Name Validation

After taking two years to implement new domain name validation methods, the CA/Browser Forum abruptly [removed two of the approved methods][21]. Domain validation methods 1 and 5, were basically methods where the CA verified that the subscriber owned the domain. These methods did not show control of the domain, nor did the validation receive approval from an authority which had control of the domain.

Although method 1 had been used in the industry for over 20 years with no evidence of attacks, this method along with method 5 were deemed unsecure and could no longer be used after August 1, 2018. In addition, any certificates issued using these methods could not be reissued without domain validation performed under another approved method. CAs that used these methods quickly changed their procedures and deprecated methods 1 and 5 with minimal reported issues.

## To 2019 and Beyond

In 2019 and moving into 2020, we will see the deprecation of TLS 1.0 and 1.1 and it is predicted that there will be an increase in phishing sites using HTTPS. We will also see the deployment of TLS 1.3 and the development of HTTP/3. Below is more information.

## Deprecate TLS 1.0 and 1.1

In 2018, TLS 1.0 version of the protocol was deprecated by PCI and further deprecation of both TLS 1.0 and 1.1 was seen throughout the ecosystem. For November 2018, Netcraft provided the following breakdown as seen from over 46 million servers:

|SSL/TLS Protocol Version |	Percentage |
|-------------------------|------------|
|SSL 3.0                	|          0 |
|TLS 1.0	                |       1.29 |
|TLS 1.1	                |       0.02 |
|TLS 1.2	                |      89.93 |
|TLS 1.3	                |       8.76 |
|Total	                  |        100 |


The browsers have also stated that they will [deprecate the use of TLS 1.0 and 1.1 starting in 2020][22]. With the rapid growth of TLS 1.3, we should see the mitigation of many known protocol vulnerabilities.

## Most Phishing Sites Will Use HTTPS

[Half of all phishing sites now use HTTPS][23]. The rate has grown since browsers began removing the positive indicator for HTTPS security and replacing it with the negative indication of no security with HTTP. The trend will probably escalate to meet the same use level of HTTPS on all page loads, which is [currently about 77 percent][24]. The rapid increase can also be correlated to the availability of free DV certificates that are issued to anonymous entities.

The downside is users will not be able to mitigate their risk of being phished by trusting an HTTPS site. Site owners should consider using EV certificates, which on many browsers will provide more trust information for users to determine if a site has a confirmed identity – verifying authenticity.

## HTTP/3

It seems we are still moving over to HTTP/2, but now HTTP/3 is in development. HTTP/3, also known as HTTP-over-QUIC, is in a [draft IETF RFC][25]. HTTP/3 will take advantage of a Google experimental protocol, Quick UDP Internet Connections (QUIC), which is a replacement for TCP.

Unlike TCP, QUIC does not provide an error-free transmission, but tolerates some data loss. QUIC incorporates TLS 1.3, so is encrypted by default, much faster and more secure than its predecessors. Hopefully, HTTP/3 will be finalized when all of the major browsers support TLS 1.3.

And, there you have it. A brief look at a very active year in the SSL/TLS ecosystem.

 [1]: https://eprint.iacr.org/2018/1173.pdf
 [2]: https://www.bleepingcomputer.com/news/security/sennheiser-headset-software-could-allow-man-in-the-middle-ssl-attacks/
 [3]: https://flipboard.com/@brucemorton/superfish-man-in-the-middle-attack-uu6ar18gy
 [4]: https://www.theregister.co.uk/2018/03/01/trustico_digicert_symantec_spat/
 [5]: https://cabforum.org/2017/03/17/ballot-193-825-day-certificate-lifetimes/
 [6]: https://groups.google.com/a/chromium.org/forum/#!topic/ct-policy/Qqr59r6yn1A
 [7]: https://support.apple.com/en-us/HT205280
 [8]: https://casecurity.org/2018/04/10/tls-1-3-includes-improvements-to-security-and-performance/
 [9]: https://tools.ietf.org/html/rfc8446
 [10]: https://casecurity.org/2014/04/11/perfect-forward-secrecy/
 [11]: https://caniuse.com/#feat=tls1-3
 [12]: https://www.thesslstore.com/blog/google-will-remove-the-secure-indicator-in-september/
 [13]: https://casecurity.org/2018/05/18/ca-browser-forum-governance-reform/
 [14]: /uploads/2018/06/London-Protocol-v1.6-5-28-2018.pdf
 [15]: https://stripe.ian.sh/
 [16]: https://groups.google.com/forum/#!msg/mozilla.dev.security.policy/fyJ3EK2YOP8/yvjS5leYCAAJ
 [17]: https://support.apple.com/en-ca/HT208860
 [18]: https://cloudblogs.microsoft.com/microsoftsecure/2018/10/04/microsoft-partners-with-digicert-to-begin-deprecating-symantec-tls-certificates/
 [19]: https://blog.mozilla.org/security/2018/03/12/distrust-symantec-tls-certificates/
 [20]: https://blogs.oracle.com/java-platform-group/jdk-distrusting-symantec-tls-certificates
 [21]: https://cabforum.org/2018/02/05/ballot-218-remove-validation-methods-1-5/
 [22]: https://www.entrustdatacard.com/blog/2018/november/deprecating-tls
 [23]: https://krebsonsecurity.com/2018/11/half-of-all-phishing-sites-now-have-the-padlock/
 [24]: https://casecurity.org/2018/12/06/ca-security-council-casc-2019-predictions-the-good-the-bad-and-the-ugly/
 [25]: https://tools.ietf.org/html/draft-ietf-quic-http