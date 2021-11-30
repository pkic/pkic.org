---
authors:
- Rick Andrews
categories:
- General
date: "2014-01-16T16:00:40+00:00"
dsq_thread_id:
- 2127857340
keywords:
- mixed content
- ssl
- identity
- https
- google
- microsoft
- openssl
- encryption
- tls
tags:
- Mixed Content
- SSL/TLS
- Identity
- Google
- Microsoft
- OpenSSL
- Encryption
title: Always-On SSL, Part I


---
There is no doubt that content owners and publishers have a duty to encourage trust and the confidence during internet usage by adopting security best practices. If a customer believes that their data and identity are safe and protected, they are more inclined to continue their online transactions. Industry best practices for website protection should be vendor-neutral, easy to implement, and globally accessible. Websites should take all the reasonable steps possible to adopt best practices in secure design and implementation, and this includes using Always-On SSL across the entire website.

{{< button type="success" link="/uploads/2014/01/Always-On-SSL.pdf" label="Download our Always-On SSL Whitepaper" >}}

### The 2 Big Myths of Always-On SSL

**_SSL is computationally expensive._** Some organizations haven’t implemented Always-On SSL because of the misunderstanding about increasing web operational overhead and costs. On a high-volume website, the reasonable assumption has been that the additional computation of adding encryption/decryption will require a new hardware investment. Researchers at Google performed extensive research on the computational load associated with Always-On SSL, and determined that for their high-volume site, there was no need for additional hardware to implement in their IT ecosystem. It is recommended that organizations consider testing the performance of Always-On SSL on their own web server to see any possible performance impacts in their unique environment.

**_The network latency of Always-On SSL will present inevitable performance degradation._** The use of Always-On SSL does incur some network latency, due to additional complexity in the SSL/TLS handshake. This is of course complicated over long distances, or in areas where network bandwidth is limited, as well as on sites where users initiate a lot of very short SSL/TLS sessions. The performance penalty can be managed in most places with proper planning, and there are new initiatives including Google’s SPDY that will help improve performance in protocol speed. The security to end-user impact analysis was completed by big social media hitters like Twitter and Facebook, and they have chosen in favor of security. There are many ways to optimize the SSL experience that we’ll discuss.

### What Does Always-On SSL Protect Against?

Many websites give their users a false sense of security, by using the HTTPS protocol to transmit login information over an encrypted SSL, but then downgrade the connection to HTTP after setting up the session. This may protect the user’s password, but the session ID in the cookie is transmitted in plain text when the client browser makes new requests to the domain. This leaves the client vulnerable to session hijacking attacks. 

Hackers created tools like “Ferret,” “Hamster,” “CookieMonster,” and “Firesheep” to hijack HTTP sessions. Additionally, if the site uses HTTPS everywhere but doesn’t mark the session cookies as secure, when the user types in partial URLs, their cookies may be exposed during the first request before the site redirects them to HTTPS. If a site uses ALWAYS-ON SSL, the user is protected throughout the browsing experience.

### How to Make Always-On SSL Work For You

All sites built today should use HTTPS by default, and always redirect HTTP connection requests immediately to HTTPS, especially for web forms. While designing Always-On SSL into the website from the beginning as part of secure development practices will be cheaper and easier than adapting it after production, the difference is not that great in reality. Here’s a checklist for steps to enable Always-On SSL: 

  1. Install an SSL/TLS certificate from a reputable certificate authority. 
  2. Configure your web server to enforce a minimum session key strength of 128-bits. For example, if using OpenSSL-based web servers, use the `Require expr` directive to test `SSL_CIPHER_USEKEYSIZE`.
  3. Make sure you install the full certificate chain, from end-entity to intermediate to root (where needed).
  4. Disable access via Port 80 during testing.
  5. Set the Secure flag for all session cookies.
  6. Check all your pages (through automated means if possible) for non-secure connections back to the site.
  7. Avoid mixed content on your page, and do some manual testing to find any remaining places where content is accessed via port 80.
  8. When all the port 80 accesses have been closed off, you can re-open port 80 and have it always redirect to port 443. 

### More on the Topic of Mixed Content

Opera, IE, Firefox, and Safari all throw mixed-content warnings when developers use hyperlinks from insecure sources or third parties. Some instances block the content entirely. This means that if you are serving images from an insecure directory or HTTP resource, the web browsers are already telling the world about your insecure practices by supplying the user with a warning (“This webpage contains content that will not be delivered using a secure HTTPS”). This is more than just an annoyance – it’s an insecure coding practice that has been ignored for a while due to convenience, and is coming to the forefront to be addressed with the latest browser updates. 

How do you avoid having your page/content/app blocked? Make sure your page doesn’t call any insecure content over HTTP or port 80. One way to avoid the issue of mixing secure and insecure content is to use relative links. Be warned that relative links can possibly be exploited by search engine spamming or 302 Hijacking attacks, so be very mindful of the needs versus risks when deciding where and when to use them.

Major industry players like Twitter, Facebook, and Microsoft’s outlook.com and live.com, as well as some app stores are advocating and implementing Always-On SSL as best practices to help protect the safety of the user experience. Many financial organizations have done the same, extending the practice out to vendors that handle all the aspects of the online banking experience.