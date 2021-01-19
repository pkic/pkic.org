---
title: 2014 – Looking Back, Moving Forward
authors: [Bruce Morton]
date: 2014-01-06T20:00:12+00:00
dsq_thread_id:
  - 2095825837


---
### Looking Back at 2013

## Protocol Attacks

The year started with a couple of SSL/TLS protocol attacks: [Lucky Thirteen][1] and [RC4 attack][2]. Lucky Thirteen allows the decryption of sensitive information, such as passwords and cookies, when using the CBC-mode cipher suite. Lucky Thirteen can be mitigated by implementing software patches or preferring the cipher suite RC4.

That being said, RC4 was also attacked, where through 16 million sessions a small amount of plaintext can be recovered. The best solution to mitigate the RC4 attack and CBC attacks is to move to TLS 1.2 and use AEAD cipher suites.

## Driving the Baseline

In February, [Mozilla issued a policy][3] to require the CAs to be audited to the [SSL Baseline Requirements][4]. Microsoft has now updated their policy to require Baseline Requirements audits as well for SSL CAs. As such, through their next audits, all SSL publicly trusted CAs will need to produce a successful Baseline Requirements audit report.

## Goodbye, 1024-Bit RSA

2013 will see the end of most SSL certificates using 1024-bit RSA keys. Since 2010, most CAs require that SSL certificates with 1024-bit RSA keys expire by December 31, 2013. There are some active certificates that were issued before this policy was adopted and they will be left to expire unless there is an attack on 1024.

## ICANN Has gTLD?

[ICANN started to release new gTLDs][5]. This has impact to Subscribers that have certificates that were issued with non-registered names that coincidently use a newly approved gTLD. Those Subscribers have to get their domain name registered within 120 days from the date that the gTLD was approved. If the Subscriber is not able to register their domain name, then the CA will have to revoke the certificate.

## The Snowden Papers

The big news was provided by [Edward Snowden][6] who revealed evidence that the NSA and British Intelligence have been performing [pervasive surveillance][7] on the Internet. The IETF calls this an attack and is looking into technical means to make Internet surveillance targeted and overt. From the SSL point of view, Subscribers should consider Always-on SSL and Perfect Forward Secrecy.

### To 2014 and Beyond

## Always-on SSL

In 2014, [Always-on SSL][8] should be a consideration for all website operators. Always-on SSL will mitigate session hijacking and MITM attacks, supports end-to-end encryption, and provides website owner identification.

When we suggest Always-on SSL, we mean taking consideration of the latest technologies and the best practices when deploying SSL. As such, website operators should consider the following:

  * [**HTTP Strict Transport Security (HSTS)**][9] &#8211; Allows the website owner to advise end-users that the website is only available in HTTPS mode. Browsers that support HSTS will provide an error when the site is accessed in HTTP-only mode.
  * [**2048-Bit RSA keys**][10] &#8211; As 1024-bit keys are no longer permitted, website operators will have to deploy certificates with 2048-bit keys. Website operators may also want to look into ECC keys or implementations with servers that concurrently support both RSA and ECC.
  * [**TLS 1.2**][11] – Uses the latest ciphers and will mitigate BEAST and RC4 attacks.
  * [**Perfect Forward Secrecy**][12] &#8211; Will mitigate pervasive surveillance. Perfect Forward Secrecy can be deployed by ensuring your server supports  and prefers cipher suites with Diffie-Hellman ephemeral (DHE) or Elliptic Curve Diffie-Hellman ephemeral (ECDHE).
  * [**SSL/TLS Deployment Best Practices**][13] – Qualys SSL Labs has documented a set of SSL/TLS best practices. These practices provide advice on private keys, certificates, server configuration, performance and application design.

## Deprecation of SHA-1

In November 2013, [Microsoft introduced its SHA-1 deprecation policy][14]. The new policy will require the CAs to stop signing with the SHA-1 hashing algorithm as of January 1, 2016. It also means that Microsoft Windows will no longer support SHA-1 as of January 1, 2017.

Microsoft will review this policy in 2015 and consider changing the deadlines based on whether SHA-1 is still resistant to pre-image attacks and whether a significant portion of the ecosystem is still not capable of switching to SHA-2. Nevertheless, certificate Subscribers need to test their systems and make plans to support SHA-2.

## Later in 2014 and Beyond

We may see consideration for new standards or policy requirements to address the following:

  * [**Public Key Pinning**][15] &#8211; Allows a certificate Subscriber to designate a key as trusted for certificates protecting each website.
  * [**Certificate Transparency**][16] – Where issued SSL certificates will be recorded in a log server. The log server will allow domain owners to monitor whether fraudulent certificates were issued to their domain names. Supporting browsers will also be able to notify end-users when they find a website with a fraudulent certificate.
  * [**Code Signing Baseline Requirements**][17] – The CA/Browser Forum is working on a Code Signing Baseline Requirements standard. This standard will specify the minimum requirements for a CA that issues code signing certificates. It will provide requirements to mitigate threats, such as private key protection, identity verification and threat detection.
  * [**Certification Authority Authorization (CAA)**][18] – Allows the CA to make a [DNS][19] check to see if it is authorized or unauthorized to issue a certificate for the requested domain. When the CA is unauthorized, they can request permission from the domain owner or indicate to the owner that there is a potential attack on their domain.

As we move into 2014 and beyond, we will continue to see Internet security improve, allowing more secure connections between websites and end-users.

 [1]: https://www.imperialviolet.org/2013/02/04/luckythirteen.html
 [2]: http://www.isg.rhul.ac.uk/tls/
 [3]: https://www.entrust.com/mozilla-endorses-ssl-baseline-requirements/
 [4]: https://cabforum.org/baseline-requirements-documents/
 [5]: https://casecurity.org/2013/03/22/what-the-icann-ssac-report-doesnt-tell-you/
 [6]: http://www.entrust.com/intelligence-services-information-security/
 [7]: https://casecurity.org/2013/11/26/ietf-88-pervasive-surveillance/
 [8]: https://otalliance.org/resources/AOSSL/index.html
 [9]: http://tools.ietf.org/html/rfc6797
 [10]: https://www.entrust.com/moving-to-2048-bit-keys/
 [11]: https://casecurity.org/2013/09/19/its-time-for-tls-1-2/
 [12]: http://blog.ivanristic.com/2013/06/ssl-labs-deploying-forward-secrecy.html
 [13]: https://www.ssllabs.com/projects/best-practices/index.html
 [14]: https://blogs.technet.com/b/pki/archive/2013/11/12/sha1-deprecation-policy.aspx
 [15]: https://casecurity.org/2013/08/28/public-key-pinning/
 [16]: https://casecurity.org/2013/09/09/what-is-certificate-transparency-and-how-does-it-propose-to-establish-certificate-validity/
 [17]: https://casecurity.org/2013/11/14/improving-code-signing/
 [18]: https://casecurity.org/2013/09/25/what-is-certification-authority-authorization/
 [19]: https://en.wikipedia.org/wiki/Domain_Name_System