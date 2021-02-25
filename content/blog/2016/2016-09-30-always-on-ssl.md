---
authors:
- Rick Andrews
- Ben Wilson
date: "2016-09-30T17:12:49+00:00"
dsq_thread_id:
- 5186198061
- Initiative
keywords:
- openssl
- encryption
- tls
- firefox
- mixed content
- qualified
- ssl
- https
- identity
- google
- microsoft
- policy
tags:
- OpenSSL
- Encryption
- SSL/TLS
- Firefox
- Mixed Content
- Qualified
- Identity
- Google
- Microsoft
- Policy
title: Always-On SSL


---
There is no doubt that content owners and publishers have a duty to encourage trust and the confidence during internet usage by adopting security best practices. If a customer believes that their data and identity are safe and protected, they are more inclined to continue their online transactions. Industry best practices for website protection should be vendor-neutral, easy to implement, and globally accessible. Websites should take all the reasonable steps possible to adopt best practices in secure design and implementation, and this includes using Always-On SSL across the entire website.

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

The SSL/TLS protocol has more to offer than just providing you with transmission encryption. Its main benefit is that it provides a way for third parties to authenticate connections to your website over the Internet. A user who can connect to your site and retrieve information via SSL/TLS will have greater assurance and trust that information came from you. The point of Always-On SSL is that once a user is able to create an authenticated connection to your point of presence via https, then he or she should not be bounced back outside of that zone of protection. When content is communicated via HTTPS, it is because you expect to provide a level of security — and your users come to expect them as well. Once you welcome a visitor, it makes no sense to have them go back outside in order to knock. This is just one of several illustrations I’d like to present where heightened protection of a visitor should be maintained, and hopefully these examples will illustrate why Always-On SSL is the preferred method for providing web visit security.

Take the first-time visitor, who comes to your site and begins to browse. They might want to review your privacy policy or terms of use in order to know whether you will communicate with them securely and protect their privacy. First and foremost, users today want to know whether they can trust you with their information, and secondarily, will you protect them from others with malicious intent? As they navigate your site, they do not want to be redirected to insecure content, which will happen once you start pointing them to HTTP resources — basically you are breaking down the secure channel that you established in the first place with HTTPS.

So, my first point is that even if you do not implement Always-On SSL, you should at least begin by offering HTTPS everywhere on your site where a user may visit. Once the user has established https session from your homepage, don’t bounce them back and forth between http and https — certainly not during the sign-up process, and never for log-in pages. During what should be a secure enrollment process, you do not want the new user to click on a hyperlink for your “Terms of Service Agreement” only to read it from an insecure connection. Returning visitors may want to browse through some of your web pages before logging in, but that does not mean that SSL/TLS is only for https://login.yoursite.com — https is not just for when users want to click onto an internal account page. As general rules, use secure cookies and force https. If a user attempts to retrieve a page with “http:”, re-direct them back via https.

Know and control your server infrastructure. It is quite common for businesses to link into a variety of service providers with content for customer satisfaction surveys, shopping cart providers, human resources, corporate communications, and for vendors and suppliers. Large enterprises may have links to other internal departments or corporate affiliates. Always-On SSL requires that these cross-references be https as well. As was noted in the previous blog post on this topic, but which is well-worth repeating here — avoid mixed content by checking your site content for instances of http and scan your code to ensure that it doesn’t call any insecure content over HTTP or port 80. Graphics and images should be delivered over port 443 as well. Otherwise, browsers such as Firefox and Internet Explorer will block your site from rendering, or links will appear broken, “not found” 404 error messages will be found throughout your site, and other warnings, such as, “This connection is not fully secure because it contains unencrypted elements, such as images” will decrease visitor confidence.

Similarly, make sure that the certificate that you have installed covers all of the content from your servers. If content is spread across multiple servers, or even multiple domains, get a unified communication / multi-SAN certificate containing all of the fully qualified domain names (FQDNs) of those servers. For example, if you have a bundle of virtual servers (secure.login.net, content.mysite.com, and images.mysite.com) that a site visitor needs to communicate with, then your server certificate will need to contain all three of those FQDNs. Otherwise site visitors will receive an error message that a secure connection has failed.

Finally, if you are using a hosted solution work closely with your provider to ensure that they can deliver all of your web pages over SSL; configure your online spaces as “https” areas (e.g. in WordPress, under “General Settings” include “https” at the beginning of your Site Address URL); and make sure your hosting provider has the technical expertise to support Always-On SSL and is able to ensure that all of your websites have matching SSL certificates.