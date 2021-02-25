---
authors:
- Ryan Hurst
date: "2013-06-29T01:19:26+00:00"
dsq_thread_id:
- 1942637664
keywords:
- tls
- tls 1.2
- dh
- casc
- vulnerabilities
- tls 1.0
- rsa
- pki
- ssl
- https
- attack
- rc4
- openssl
- forward secrecy
series:
- Getting the Most Out of SSL
tags:
- SSL/TLS
- TLS 1.2
- DH
- CASC
- Vulnerability
- TLS 1.0
- RSA
- PKI
- Attack
- RC4
- OpenSSL
- Forward Secrecy
title: 'Getting the Most Out of SSL Part 2: Configuration'


---
They say the most complicated skill is to be simple; despite SSL and HTTPS having been around for a long time, they still are not as simple as they could be.

One of the reasons for this is that the security industry is constantly learning more about how to design and build secure systems; as a result, the protocols and software used to secure online services need to continuously evolve to keep up with the latest risks.

This situation creates a moving target for server administrators, creating a situation where this year’s “best practice” may not meet next year’s. So how is a web server administrator to keep up with the ever-changing SSL deployment best practices?

There is, of course, a ton of great resources on the web that you can use to follow industry trends and recent security research, but it’s often difficult to distill this information into actionable and interoperable SSL configuration choices.

To help manage this problem the [CA Security Council provides a tool][1] that looks at your server’s configuration and makes recommendations on what you should change to address current industry best practices. This tool makes recommendations that are based on current and past security research, trends, and both client and server behavior and capability.

The tool performs over 33 different tests on your server configuration and, based on the results, recommends specific changes you should make to address its findings.

In general, the guidance the tool provides can be categorized as follows:

## ✓ Support latest versions of TLS protocol

Often organizations are slow to pick up newer versions of their web server and SSL implementations. This is normally a conscious decision attributed to the old adages of “if it’s not broken don’t fix it.”

The problem is that these older versions are plagued with security issues. In many cases, these organizations pick up security patches, but these patches do not include the more recent (and more secure) versions of the protocols.

It is important that all sites add support for TLS 1.2 as this new version of the protocol offers security improvements over its predecessors and lays the groundwork for addressing future security concerns.

## ✓ Disable older known insecure versions of the SSL protocol

SSL was defined in 1995 and has evolved significantly since then. SSL 2.0, in particular, has been found to have a number of vulnerabilities. Thankfully, these issues have been resolved in a later version of the protocol.

Unfortunately at least 28% of sites today still support it (based on SSL-pulse data); when I speak to server administrators about why they enable this older version they commonly mention concerns over client interoperability. Thankfully browser statistics show us that TLS 1.0 support is ubiquitous and it is no longer necessary to support the older insecure version of the protocol.

## ✓ Choose secure and modern cipher suites

This is one of the more confusing parts of configuring SSL; it’s also one of the most important. No matter how strong the cryptographic key material that goes into your certificate, the strength of your SSL is only as secure as the cryptography used to encrypt the session.

You don’t need to be a cryptographer or security researcher to make the right choices though, the CASC SSL configuration checker will help you keep on top of current recommendations. 

Based on current research, the following would be solid choices for you to go with:

**Apache**
```ini
SSLProtocol -ALL +SSLv3 +TLSv1 +TLSv1.1 +TLSv1.2;  
SSLCipherSuite ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-RC4-SHA:ECDHE-RSA-AES128-SHA:AES128-GCM-SHA256:RC4:HIGH:!MD5:!aNULL:!EDH:!CAMELLIA;
SSLHonorCipherOrder on;
```

**Nginx**
```ini
ssl_protocols SSLv3 TLSv1 TLSv1.1 TLSv1.2;  
ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-RC4-SHA:ECDHE-RSA-AES128-SHA:AES128-GCM-SHA256:RC4:HIGH:!MD5:!aNULL:!EDH:!CAMELLIA;  
ssl_prefer_server_ciphers on;
```

These settings were chosen based on several factors including strength of the cryptography, interoperability and support for forward secrecy whenever it is supported by both the client and the server. 

What is forward secrecy? You have forward secrecy when an attacker needs more than the encrypted traffic from your server and its private key to decrypt the traffic.

## ✓ Disable insecure options in SSL and HTTP

As a general rule, protocols have options; these options can have unforeseen side-effects.

A great example of this is the option of SSL compression. Compression was added to SSL to improve performance of the protocol but it had a side effect – it enabled attackers to perform cryptanalysis on the cryptographic keys used in SSL. This attack was called CRIME (Compression Ratio Info-leak Made Easy) and, as such, this option is disabled today in secure SSL configurations.

Ensuring your configuration does not enable any such options is key to having a secure SSL configuration.

## ✓ Enable performance optimizing options in SSL

To truly benefit from deploying SSL you need to apply it to your whole site — not doing so exposes sessions to attacks. The most common reason I hear from organizations as to why they are not deploying SSL across their whole site concerns performance.

This is a legitimate concern, according to Forester Research “The average online shopper expects your pages to load in two seconds or less, down from four seconds in 2006; after three seconds, up to 40% will abandon your site.”

And while it is true that an improperly configured web server will perform notably different than a properly configured one, it’s not difficult to configure your servers so that performance is not a major concern.

Part 3 of this series will discuss the implications of SSL for SEO, your content and applications.

Ryan Hurst, CTO, GlobalSign

## Resources

  * [Getting the Most Out of SSL Part 1: Choose the Right Certificate][2], CA Security Council
  * [SSL Configuration Checker][1], CA Security Council
  * [SSL Pulse][3], Trustworthy Internet Movement
  * [Bulletproof SSL/TLS and PKI][4], Ivan Ristic
  * [High Performance Browser Networking][5], Ilya Grigorik
  * [How to get the latest stable OpenSSL, Apache and Nginx][6], Ryan Hurst
  * [Always On SSL][7], OTA
  * [Revocation Report][8], X509 Labs
  * [Transport Layer Security][9], WikiPedia
  * [Perfect forward secrecy][10] , Wikipedia 
  * [SSL Labs: Deploying Forward Secrecy][11], Qualys
  * [Intercepted today, decrypted tomorrow][12], Netcraft

 [1]: https://casecurity.ssllabs.com/
 [2]: https://casecurity.org/2013/05/24/getting-the-most-out-of-ssl-part-1-choose-the-right-certificate/
 [3]: https://www.trustworthyinternet.org/ssl-pulse/
 [4]: https://www.feistyduck.com/books/bulletproof-ssl-tls-and-pki/
 [5]: http://chimera.labs.oreilly.com/books/1230000000545
 [6]: http://unmitigatedrisk.com/?p=357
 [7]: https://otalliance.org/resources/AOSSL/index.html
 [8]: https://revocation-report.x509labs.com/
 [9]: https://en.wikipedia.org/wiki/Transport_Layer_Security
 [10]: http://en.wikipedia.org/wiki/Perfect_forward_secrecy
 [11]: https://community.qualys.com/blogs/securitylabs/2013/06/25/ssl-labs-deploying-forward-secrecy
 [12]: http://news.netcraft.com/archives/2013/06/25/ssl-intercepted-today-decrypted-tomorrow.html