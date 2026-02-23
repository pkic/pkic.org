---
authors:
- Wayne Thayer
date: "2015-04-20T15:15:10+00:00"
dsq_thread_id:
- 3692533089
keywords:
- announcement
- google
- microsoft
- forward secrecy
- tls
- ietf
- vulnerabilities
- hsts
- mozilla
- firefox
- chrome
- ssl
- https
tags:
- Announcement
- Google
- Microsoft
- Forward Secrecy
- SSL/TLS
- IETF
- Vulnerability
- HSTS
- Mozilla
- Firefox
- Chrome
title: HTTP/2 Is Speedy and Secure


---
Since we last [wrote about SSL/TLS performance][1], there has been a lot of activity in the IETF HTTP Working Group, resulting in the February announcement that the next version of HTTP has been approved. This is big news because it means that major SSL/TLS performance improvements are on the way.

## Background

When your browser connects to a website today, it most likely uses the HTTP/1.1 protocol that was defined in 1999 in [RFC 2616][2]. Over the past 15 years, HTTP/1.1 has served us well and many tweaks have been discovered to make the most of it. However, in that time the web has transformed into a platform for interactive content and applications. Today, browsers load much more data from many more sources to build the typical web page.

In 2009 Google announced a research project called SPDY (pronounced “speedy”) in a [blog post][3] titled _A 2x Faster Web_. SPDY requires the use of SSL/TLS. In 2010 Google added SPDY support to Chrome and the next year they added SPDY support to all Google services. Later they announced that [SPDY improves performance of their services by up to 43%][4]. SPDY continued to gain popularity as it was implemented in major web browsers and servers, by CDNs, and by other popular sites including X. With SPDY gaining traction and showing significant performance benefits, the IETF chartered development of HTTP/2 in 2012 and later decided to base it on SPDY.

The goals set out for HTTP/2 include:

  * Improving performance by reducing “end-user perceived latency” and addressing a few specific HTTP/1.1 performance issues
  * Compatibility with HTTP/1.1. This means that URLs and status codes like the familiar ‘404 Not Found’ haven’t changed
  * Interoperability with HTTP/1.1, allowing web servers and browser to support both versions as usage of HTTP/2 grows over time

HTTP/2 achieves these goals by making a number of fundamental changes to the way data is communicated from the server to the browser. First off, HTTP/2 is a binary protocol, meaning that it is more efficient and less error prone. This also means that using telnet to connect to a web server and type simple commands like ‘GET /index.html’ doesn’t work with HTTP/2.

Arguably the biggest change is that HTTP/2 is “multiplexed”. This means that one network connection can serve requests for many pieces of content at the same time. Doing this reduces waiting while each individual piece of the web page is loaded. It also eliminates the current practice of browsers opening multiple simultaneous connections to the same server and in turn makes better use of network resources.

Web servers include headers with every response they send to the browser. Headers contain information about the content including cookies. Modern web applications use lots of cookies, and load lots of content on each page. This means that headers end up accounting for quite a bit of the data being transferred, and by compressing all this data, HTTP/2 is faster.

Finally, HTTP/2 allows a web server to anticipate that a browser is going to request a piece of content and proactively send that content to the browser before being asked for it. This is called “Server Push”. Since the server doesn’t have to wait to be asked, pages can be loaded faster.

## More Secure

Google designed SPDY to require the use of SSL/TLS, and during the drafting of the HTTP/2 spec this requirements was vigorously debated. The outcome is that HTTPS is not a requirement for HTTP/2 – it supports unencrypted communications via HTTP. However, Mozilla has stated that Firefox will only support HTTP/2 over SSL/TLS, and so far both Google and Microsoft have only released HTTP/2 support over SSL/TLS. Even if Microsoft and Google do implement HTTP/2 without requiring SSL/TLS, Mozilla’s decision alone is a strong reason for websites to deploy SSL/TLS so they can benefit from HTTP/2.

The best news about HTTP/2 from a security perspective is that it specifies the use of best practices for HTTPS. TLS version 1.2 is required, eliminating vulnerabilities present in older versions. In addition HTTP/2 requires that the compression and renegotiation features of the protocol be disabled due to risks that they expose when used. Finally, the spec bans weak cipher suites and requires support for [Perfect Forward Secrecy][5].

## Coming Soon

As of this writing, we’re still waiting for HTTP/2 to be published as a standard, but support for draft versions is already available in Google Chrome and Mozilla Firefox, as well as Microsoft’s Internet Explorer in the Windows 10 Technical Preview. X has deployed HTTP/2 on their servers, so you might already be benefitting from HTTP/2 without knowing it! Akamai has also published a [demonstration site][6].

Support for HTTP/2 in web servers is also [progressing][7] nicely. While it’s probably too early for most sites to roll out HTTP/2, you should be aware of it and start making plans to reap the benefits. Your website needs to support SSL/TLS, and now would be a good time to consider implementing [Always-on SSL][8] and [HSTS][9] to ensure that you’re ready for HTTP/2.

 [1]: https://casecurity.org/2014/10/30/extra-trips-are-for-frequent-flyers-not-ssltls-performance/
 [2]: https://www.ietf.org/rfc/rfc2616.txt
 [3]: http://googleresearch.blogspot.com/2009/11/2x-faster-web.html
 [4]: http://blog.chromium.org/2013/11/making-web-faster-with-spdy-and-http2.html
 [5]: https://casecurity.org/2014/04/11/perfect-forward-secrecy/
 [6]: https://http2.akamai.com/
 [7]: https://github.com/http2/http2-spec/wiki/Implementations
 [8]: https://casecurity.org/2014/01/16/always-on-ssl-part-i/
 [9]: https://casecurity.org/2014/10/08/secure-your-website-with-hsts/