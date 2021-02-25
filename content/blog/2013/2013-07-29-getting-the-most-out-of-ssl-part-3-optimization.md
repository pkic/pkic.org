---
authors:
- Rick Andrews
- Ryan Hurst
date: "2013-07-29T15:03:42+00:00"
dsq_thread_id:
- 1939290999
keywords:
- mixed content
- ssl
- https
- tls
- mitm
tags:
- Mixed Content
- SSL/TLS
- MITM
title: 'Getting the Most Out of SSL Part 3:  Optimization'


---
To get the most out of SSL/TLS, you need to do a bit more than just configure your web server with an SSL certificate. The information below will help you optimize your website’s use of SSL. Making the changes suggested below will also help move your site towards “Always On SSL” (<https://otalliance.org/resources/AOSSL/index.html>), a best practice in which you serve the entire contents of your website over SSL/TLS.

## Changes to the content of your website

Some HTML tags can include attributes that are links or paths to other pages on your site. These paths can be absolute (explicitly referencing a protocol and domain name, like href=”http://foo.example.com/index.htm” or src=”https://foo.example.com/script.js”) or relative (like href=”/index.htm” or src=”/script.js”).

We suggest using relative references as much as possible. The best reason to use relative references is to keep your users from encountering “mixed content” warnings. Also note that some modern browsers will not give warnings, but instead block certain mixed content without alerting the user. And relative references have other advantages too: They are independent of what protocols are used to transport the content, and they make your pages a bit smaller and therefore faster to load.

## Changes to references for external content and scripts

Another scenario that can cause “mixed content” warnings is when sites use scripts and content hosted on other servers (like [YouTube Embeds][1] or [Google Analytics][2]) that explicitly reference HTTP. If your site is accessed over HTTPS, you’ll want to access these external sites over HTTPS as well. An easy way to do this is to use protocol-relative URLs. For example, instead of href=  
“http://foo.example.com/index.htm”, use href=”//foo.example.com/index.htm”. The browser will then use HTTP to access foo.example.com if your page is served over HTTP, and HTTPS if your page is served over HTTPS.

Keep in mind is that the perceived performance and actual security of your site is dependent on the performance and security of the providers you include in it. We strongly recommend that you check their [performance][3] and [SSL configuration][4] and ask them to make any changes necessary to address any issues you see.

## SSL’s impact on Search Engine Optimization (SEO)

To achieve all the security benefits of SSL you have to deploy SSL across your entire site (this is commonly referred to as Always On SSL). This means that as far as a search engine is concerned there could be two copies of the same content. This is treated as a negative condition in most page ranking schemes, but that can be addressed in a few ways:

**Tell the search engine which content is authoritative** (which one you want them to index), by:
1. Updating `<link rel="canonical">` to point to the HTTPS version (see [https://support.google.com/webmasters/answer/139394?hl=en](https://support.google.com/webmasters/answer/139394?hl=en)).
2. Updating the XML Sitemap (see [http://en.wikipedia.org/wiki/Site_map](https://support.google.com/webmasters/answer/139394?hl=en)) to refer to the HTTPS version of the content.

Making these two changes ensures the search engine will index the SSL version of the site so the first link the user visits will be your HTTPS version.

This improves the user’s experience by getting them to your content quicker (instead of relying on a rewrite rule to move them from HTTP to HTTPS) but also helps to mitigate Man-In-The-Middle (MITM) attacks that would be possible if your site is served over HTTP. 
      
1. **Ensure the robots.txt is available over SSL**. You can direct web crawlers to avoid crawling parts of your website by using a robots.txt file (see [http://www.robotstxt.org/robotstxt.html](http://www.robotstxt.org/robotstxt.html)). Make sure this file is available via HTTPS.
2. **Redirect all HTTP requests to your site to the HTTPS version** using a permanent redirect (a HTTP 301). This will transfer your search engine PageRank to the SSL or HTTPS URL.
3. **Update the search engine webmaster tools to refer to the HTTPS** URL instead of the HTTP URL. See [www.google.com/webmasters/tools](http://www.google.com/webmasters/tools) for more details.
      
## Other considerations

You may be concerned about the performance of SSL. Some people say that SSL is computationally expensive, but we don’t believe it. Nor do many high-volume websites that have already adopted Always On SSL. Please see [https://www.imperialviolet.org/2011/02/06/stillinexpensive.html](https://www.imperialviolet.org/2011/02/06/stillinexpensive.html).

You may be serving page content from a number of internal sites (sometimes called “domain sharding”). If all those sites are also accessed over HTTPS, your users need to start a new SSL connection with each one, and the SSL connection setup is the most costly part of the SSL session. Make sure that these servers implement session caching and resumption ([http://en.wikipedia.org/wiki/Transport_Layer_Security#Resumed_TLS_handshake](http://en.wikipedia.org/wiki/Transport_Layer_Security#Resumed_TLS_handshake)) to reduce the impact of the SSL overhead. You can also try to limit the number of domains when sharding to reduce the number of sessions needed to render a site.

You may also want to look at deploying a forward proxy or load balancer in front of your web servers where all SSL would be terminated. This can provide performance benefits beyond SSL and can simplify key and SSL management in your environment at the same time.

Don't forget cookies: While all sensitive cookies should already be marked “secure” so they won’t get sent over non-secure sessions, you should consider marking all cookies as “secure” when your entire site is served over SSL.

Finally, setting the [HTTP Strict Transport Security](http://en.wikipedia.org/wiki/HTTP_Strict_Transport_Security) header means browsers will visit you over HTTPS every time, even if search results return HTTP URLs. This will improve perceived performance and help protect from MITM attacks.

 [1]: http://apiblog.youtube.com/2011/02/https-support-for-youtube-embeds.html
 [2]: https://support.google.com/analytics/answer/1008080?hl=en
 [3]: http://www.webpagetest.org/
 [4]: https://casecurity.ssllabs.com/