---
title: Gogo Found Spoofing Google SSL Certificates
authors: [Rick Andrews]
date: 2015-01-08T19:17:13+00:00
dsq_thread_id:
  - 3402552367


---
It was [recently disclosed][1] that Gogo, a provider of Wi-Fi Internet services on commercial aircraft, has been issuing spoofed SSL certificates for Google sites that were viewed by customers of Gogo&rsquo;s service. It appears that [Gogo Inflight Internet][2] was acting as an SSL Man-in-the-middle (MITM), a technique used within some enterprises to allow themselves to inspect and control all web traffic, even traffic to secure web sites.  To understand what this means, let me explain MITM in a bit more detail.

While not very common, there are enterprises that use SSL MITM technology to protect their employees and assets. For example, the enterprise can see when their employees visit sites that attempt to deliver malware to eventually block it. Some enterprises might want to ensure that their employees don&rsquo;t visit inappropriate web sites using company equipment. The enterprise may also deploy a [Data Loss Prevention (DLP) solution][3] to guard against company secrets being divulged on public web sites. These uses are justified since the enterprise has an interest in securing its employees and their assets (laptops, desktops, corporate data, etc.)

Here&rsquo;s how an SSL MITM works: a browser user tries to open an SSL connection to a web server. The connection attempt is intercepted by the SSL MITM, which opens its own SSL connection to the intended web server. When that web server returns its SSL certificate, the SSL MITM crafts a copy of the certificate using its own public-private key pair and signed by the SSL MITM&rsquo;s private root certificate. It returns that copy of the certificate to the browser user, who sees a certificate containing the name of the intended web server. Essentially, two SSL connections are set up: one between the browser user and the SSL MITM, the other between the SSL MITM and the web server. The SSL MITM copies traffic back and forth between the parties so they are generally unaware of the SSL MITM. All SSL traffic is encrypted on the wire, but unencrypted in the SSL MITM. This allows the SSL MITM to see everything and even modify traffic in either direction. 

It&rsquo;s surprising to see a company use an SSL MITM with its customers. When used within an enterprise, the root certificate used by the SSL MITM can be installed and trusted in employee computers because the enterprise has complete control over those devices.  But this can&rsquo;t be done with the enterprise&rsquo;s customers, who control their own devices.  As a result, these customers will receive a warning when they visit a secure site intercepted by an SSL MITM. It&rsquo;s clear from the screen shot in the articles related to this issue that the user&rsquo;s browser warned them that the site&rsquo;s certificate was signed by an untrusted issuer.

What&rsquo;s not clear is if Gogo performed a man-in-the-middle interception only for YouTube, or only for Google web properties, or for all web properties secured by SSL. There&rsquo;s no reason to expect that Gogo intercepted only YouTube traffic. If done for all SSL traffic, it&rsquo;s likely that a Gogo customer visiting their bank online, for example, would be subject to the same SSL MITM. This would be worrisome, because Gogo would then be able to collect usernames and passwords used on all such sites. Gogo&rsquo;s CTO said &ldquo;Gogo takes our customer&rsquo;s privacy very seriously&rdquo;, but Gogo&rsquo;s actions raise a red flag. They could possibly have access to customer data that has nothing to do with Gogo or its services, and Internet users in a post-Snowden era are less willing to trust third parties with their personal information.

Gogo has a legitimate interest in limiting or blocking video streaming, but the way they&rsquo;ve done it is far overreaching. Perhaps they hoped that customers would avoid using YouTube when they saw a scary security warning. Sadly, an unintended side effect might be to train users to ignore and to click through those warnings, which is counterproductive to the industry&rsquo;s push for better end-user practices. Ultimately this would devalue all legitimate SSL certificates, and weaken the Certificate Authority/Browser trust model that Certificate Authorities and browser vendors have built and strengthened over the past 15+ years.

We urge Gogo to reconsider their actions and deploy bandwidth limiting solutions that do not involve the use of spoofed SSL certificates.

 [1]: http://www.neowin.net/news/gogo-inflight-internet-is-intentionally-issuing-fake-ssl-certificates
 [2]: http://www.gogoair.com/
 [3]: http://www.symantec.com/data-loss-prevention/