---
title: HTTP/2 Update
authors: [Wayne Thayer]
date: 2016-10-26T17:04:21+00:00
dsq_thread_id:
  - 5255176211
categories:
  - General

---
I wrote about the [next version of the HTTP protocol][1] 18 months ago. Since then, HTTP/2 has gained significant traction, but not without generating some controversy along the way.

### Performance

Perhaps the biggest question lingering over HTTP/2 relates to real-world performance benefits. A [demonstration][2] comparing the time it takes to load a website over HTTP/1.1 without SSL/TLS versus HTTP/2 (which only works in browsers over HTTPS) has been criticized for being unrealistic. It loads 360 unique images, a scenario that highlights the strengths of HTTP/2’s new design. The criticism comes from the fact that the average web page only loads around 100 objects (images, style sheets, etc.), and is often optimized for HTTP/1.1 using techniques that reduce the effectiveness of the HTTP/2 mechanisms.

The transition to HTTP/2 poses a performance challenge because websites may need to be de-optimized for HTTP/1.1 to take full advantage of HTTP/2. Common techniques such as combining files or images (sprites) and domain sharding – where a web page is loaded from multiple domains – are designed to reduce the number of connections to a single site. Since the majority of Website visits still occur over HTTP/1.1, it’s too soon to take these steps to eke the last bit of performance out of HTTP/2.

### Vulnerabilities

In a recent [report][3] published by security vendor Imperva, HTTP/2 was shown to be vulnerable to both old and new attacks. The report concludes that HTTP/2 implementations are young and as with any new software, vulnerabilities will be found. Yahoo! Researchers have also [published similar findings and conclusions][4]. As we will see, these concerns don’t appear to be slowing adoption.

### Browser adoption

Just about every major browser now [supports HTTP/2][5]. If you’re using an up-to-date browser, it’s very likely that you’ve been using HTTP/2 for a while now when visiting some of your favorite websites.

### Web server adoption

HTTP/2 is implemented in the current versions of all the major web servers including Apache, IIS, and NGINX. Many of the most popular CDNs also support HTTP/2, including Akamai and CloudFlare. <https://istlsfastyet.com/> is a good resource for more details on HTTP/2 support.

### Website adoption

HTTP/2 is now [supported by 10% of websites][6], up from just 1% a year ago. Adoption is strongest among the most popular websites, including Google, Facebook, and Twitter. It’s interesting to compare the adoption rate of HTTP/2 with IPv6, the newest version of the internet protocol that underpins HTTP. IPv6 became a standard almost 20 years ago and today is only used by 7% of websites.

HTTP/2 is still a relatively young technology, but the rate of adoption by web servers and browsers strongly suggests that it will become dominant. So what are you waiting for? Now is a great time to start planning HTTP/2 support for your website. Remember that browsers only support HTTP/2 over HTTPS, so you’ll need an SSL/TLS certificate to benefit.

 [1]: https://casecurity.org/2015/04/20/http2-is-speedy-and-secure/
 [2]: http://www.httpvshttps.com/
 [3]: https://www.imperva.com/docs/Imperva_HII_HTTP2.pdf
 [4]: https://yahoo-security.tumblr.com/post/134549767190/attacking-http2-implementations
 [5]: http://caniuse.com/#feat=http2
 [6]: https://w3techs.com/technologies/details/ce-http2/all/all