---
title: Extra Trips are for Frequent Flyers, Not SSL/TLS Performance
authors: [Wayne Thayer]
date: 2014-10-30T16:15:01+00:00
dsq_thread_id:
  - 3171194704


---
TLS is quickly becoming a de facto requirement for every website due to increased concerns about spying and Google’s recent move to use HTTPS as a factor in search engine ranking. In a [recent article][1] we explained how HSTS helps website operators to ensure that their site is always using TLS, but now we want to ensure that your performance isn’t sacrificed in the name of enhanced security. While the myth that TLS slows down a website has been debunked, some basic settings can make a site using TLS even faster.

A number of factors influence the performance of TLS. The most critical time is when a browser is first connecting to the site during what is known as the TLS “handshake”. A different set of factors come into play after the browser starts downloading data during a TLS “session”.

Because the handshake is by far the most critical component of TLS performance for a typical website, we’ll focus on it. The TLS handshake consists of a short conversation between the browser and the Web server during which time nothing else can happen. A typical handshake requires two “round trips” between the browser and the server. Limiting the conversation to two round trips is the single most important task in TLS performance. Reducing the handshake to less than two round trips speeds up TLS even more.

Round trips have such a big impact on performance because networks are relatively slow, especially when the browser is far away from the server. This is called latency, and is typically measured in milliseconds (ms). A browser on the other side of the globe is likely experiencing more than 250ms of latency when communicating with a website, meaning that the TLS handshake adds over 1 second to the time it takes to load your website.

The reason that more than two round trips are sometimes needed in a TLS handshake is that the Web server is sending too much data to the browser. The most common way this happens is when extra certificates are accidentally configured to be sent by the server. In most cases, the server should only need to send two certificates, but I’ve seen cases where 10 were sent, requiring at least one extra round trip to complete the TLS handshake. The Web server always needs to send the website’s certificate and should always send one intermediate certificate to allow the browser to verify the certificate properly. Sometimes a third certificate is added for various reasons, but that should be the limit. Sometimes the Web server is configured to send a root certificate to the browser – this is never required since the browser already has all of the roots that it trusts.

Another common mistake is to configure too few certificates on the Web server. Some browsers (Internet Explorer, for example) can retrieve an intermediate certificate due to a special certificate property called the AIA, others (Firefox) do not. So it’s important to make sure that you are configuring the server to at least send the intermediate CA certificate so that a chain can be built to the trust anchor. Importantly, the browsers that retrieve the intermediate certificate are actually slowed down in this scenario because they have to make a separate connection to the Certificate Authority to obtain it (unless it has been cached from a previous request).

Another big win for TLS performance is to enable [OCSP stapling][2]. This causes the server to send the revocation information for the certificate to the browser and allows the browser to avoid making a separate connection to obtain the status of the certificate. Some browsers skip this step altogether, but it’s best to enable stapling to speed up those that do check. Internet Information Server (IIS) does OCSP stapling by default, and it’s fairly easy to enable on newer versions of Apache or Nginx.

Sometimes it’s tempting to create a certificate with a 4096-bit key. You’d think that if today’s standard 2048-bit certificate is good, bigger is better, right? Well, in reality a 2048-bit key is considered unbreakable for at least the next 10 years, and anything more creates an unnecessary waste of time for most implementations (unless there is a special, extraordinary reason you are concerned about protecting the data for a long time into the future). The data exchanged with a server over TLS isn’t even encrypted by the key in the certificate, and by using [Perfect Forward Secrecy][3] a compromised certificate can’t be used to recover data from past TLS sessions. The downside to larger keys are twofold: they add data to the handshake, and they require more time to use the key in cryptographic operations.

An even better option than a 2048-bit RSA key is a 256-bit [ECC][4] key, if your CA supports this option. Not only is the key smaller in size, it requires less processing time on the server and overall. It does however require slightly more time for a client to process than an RSA key, which is something to consider for mobile devices that tend to have slower CPUs.

Another consideration is the use of multi-domain certificates. They’re great when used in moderation, but some sites put 100 or more domain names in a single certificate. From a performance perspective this isn’t the best idea because it increases the size of the certificate and requires the browser to search through the list when processing the certificate.

Finally, consider using a content delivery network (CDN) when your website visitors are spread across the country or globe. CDNs essentially reduce the latency between the browser and your website by storing content closer to the browser. If you choose to do this, be certain that you have a certificate installed on both the CDN and your original website – otherwise only half of the connection between your site and your visitor’s browser will be secured by TLS.

One of the best ways to check for some of the common performance issues we’ve described is to run our [website configuration test][5]. Get these basics right, and your website will be secure and perform like a champ.

 [1]: https://casecurity.org/2014/10/08/secure-your-website-with-hsts/
 [2]: https://casecurity.org/2013/02/14/ocsp-stapling-improved-performance-and-security-a-win-win/
 [3]: https://casecurity.org/2014/04/11/perfect-forward-secrecy/
 [4]: https://casecurity.org/2014/06/10/benefits-of-elliptic-curve-cryptography/
 [5]: https://casecurity.ssllabs.com/