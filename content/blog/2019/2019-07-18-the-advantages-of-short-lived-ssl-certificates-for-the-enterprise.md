---
authors:
- Doug Beattie
date: "2019-07-18T18:16:24+00:00"
keywords:
- revocation
- mozilla
- crl
- ssl
- https
- vulnerability
- tls
tags:
- Revocation
- Mozilla
- CRL
- SSL/TLS
- Vulnerability
title: The Advantages of Short-Lived SSL Certificates for the Enterprise


---
**Short validity period certificates** are becoming ever more common to reduce the scope of data compromised if a server vulnerability is uncovered, such as [HeartBleed][1].  Good security practice dictates changing keys on a regular basis, normally annually, but if you want to limit your exposure further, you can replace your certificates and underlying keys more frequently.

Sandstorm is an open source server software that makes it easy to install web apps. In order to solve the problem of setting up DNS without too much complication, [Sandstorm announced the release of Sandcats.io][2]. Sandcats.io is a free DNS service which takes 120 seconds to go from an empty Linux virtual machine to a working personal server with a DNS name and HTTPS. The DNS service runs on the sandcats.io server while the “personal server” runs on each individual customers’ computers.

For every Sandstorm user there is also the need for an [SSL Certificate][3], as users need to protect their data. So as a solution to this, in conjunction with GlobalSign, Sandstorm developed a method to allow each of their users to secure themselves with HTTPS in three easy steps.

Each Sandstorm customer receives their own unique subdomain under the sandcats.io, example.sandcats.io for example. The Sandstorm software uses a unique host naming convention: it uses a unique, random, short-lived host name for each session of each instance of each application. A Sandstorm.io customer can use a hostname like example.sandcats.io to see their Sandstorm dashboard, and each application they see has a hostname like qr17502o9sns24475689p33940919141.example.sandcats.io. Creating and using dynamically generated host names for each session improves security by helping to prevent XSRF, reflected XSS and clickjacking attacks. Generally those attacks require known host names; these auto-generated hostnames are hard to guess and only in existence for a short period of time, making apps much less susceptible. Keeping these hostnames as private as possible is central to getting the security benefits.

Since the TLS protocol requires the host name be present in the SSL Certificate, it was not feasible to issue traditional TLS Certificates to support Sandstorm customers, therefore  only `Wildcard SSL Certificates` of the format *.example.sandcats.io could be used.

So why did Sandstorm choose to use short-lived certificates instead of regular certificates?

[Benefits of using short validity period or short-lived certificates][4]

Using individual certificates for each customer is far superior to using large shared multi-SAN (Subject Alternative Name) certificates, where SANs from multiple sites, applications, or users are visible in the shared certificates.  This limits the exposure of the keys to each customer which can put security conscious customers’ at ease. In Sandstorm’s case, each customer controls their own private key.

## Short-lived certificates can be managed easily

Automated certificate issuance is mandatory when certificates need to be replaced frequently.  Sandstorm uses a comprehensive Managed SSL Solution (MSSL) APIs to order, reissue and revoke certificates at high rates without any user involvement.  This enables all certificates to be kept up to date and also allows the entire population of users to have their certificates immediately replaced in the event of a security flaw.

Sandstorm is taking advantage of some unique features within their managed SSL API, including the custom validity period option, which allows the specification of the desired certificate expiration date.  Sandstorm found that weekly replacement of 10-day validity period certificates worked well for them.  Other customers may prefer shorter or longer validity periods to satisfy their unique requirements.

## Short-lived certificates can be cost-effective

Flexible certificate pricing and licensing is a must when supporting customers with short-lived certificates for changing customer base, especially when Wildcard SSL Certificates are being used. Normally each Wildcard Certificate is hundreds of dollars.  Charging per certificate just doesn’t make sense in situations when there are dynamic user-bases and this is why Sandstorm is one of many SAN Licensing customers.  This allows them to have up to a specified number of unique SANs at any time.  As certificates expire they are removed from their inventory and this enables them to secure new customers without any financial impact.

## Short-lived certificates can be managed easily through CRL

By using short validity periods, the size of the [Certificate Revocation List (CRL)][5] can be better managed.  As CRLs grow, the browsers have a more difficult time retrieving and processing them, which results in slow page load times and reduced security. In the event of a large-scale security incident and revocation when using short-lived certificates, the CRL would only be large for a few days since expired certificates are removed.

## Short-lived certificates still show a warning on browsers when they have expired

GlobalSign supported industry movements towards short-lived certificates with the [CA/B Forum][6] and we continue to work with Mozilla to help identify the right validity periods to improve security.  Some browsers do not always check the revocation status of certificates, but all browsers warn when a certificate is expired.

## So where does that leave me?

If you operate a large-scale website and use subdomains to host user content, then issuing and renewing short-lived certificates through an automatic certificate issuance system will significantly decrease the scope of a security incident involving compromised keys.

 [1]: http://www.bbc.co.uk/news/technology-26969629
 [2]: https://blog.sandstorm.io/news/2015-05-18-sandcats.html
 [3]: https://blog.sandstorm.io/news/2015-10-01-free-ssl-certificates.html
 [4]: http://www.w2spconf.com/2012/papers/w2sp12-final9.pdf
 [5]: http://searchsecurity.techtarget.com/definition/Certificate-Revocation-List
 [6]: https://cabforum.org/pipermail/public/2015-October/006084.html