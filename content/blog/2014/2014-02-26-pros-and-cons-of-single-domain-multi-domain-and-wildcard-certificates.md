---
authors:
- Wayne Thayer
date: "2014-02-26T17:30:34+00:00"
dsq_thread_id:
- 2295145224
keywords:
- microsoft
- ssl
- tls
- multi-domain
- server
- website
- wildcard 
- certificates
- single-domain
tags:
- Microsoft
- SSL/TLS
title: Pros and Cons of Single-Domain, Multi-Domain, and Wildcard Certificates

---

We have previously written about the [different types of SSL certificates][1], but in that article we focused on validation levels. A recent [post on LinkedIn][2] highlighted the fact that there is another dimension that we haven’t yet explored.

SSL certificates come in three basic packages: “single-domain” certificates that can only be used on one specific website, “multi-domain” certificates that can be used on more than one website, and “wildcard” certificates that can be used on any website within a specific domain name. Multi-domain certificates are often called “unified communications” or “UC” certificates. This is a reference to one common use of these certificates, which is to secure Microsoft messaging products such as Exchange and Lync. The table below shows examples of the number and types of websites that each of these packages can protect:

| Type of Certificate | Example Websites Protected | 
|:--------------------|:---------------------------|
| Single-domain       | https://www.firstwebsite.com |
| Multi-domain (UCC)  | https://www.firstwebsite.com https://www.secondwebsite.com https://www.thirdwebsite.com |
| Wildcard (*)        | https://blog.firstwebsite.com https://www.firstwebsite.com https://shop.firstwebsite.com (unlimited number of subdomains) |

You may be wondering what the technical difference is between these packages. It all comes down to the Subject Alternative Name (SAN) field that is embedded in the certificate when it&rsquo;s issued. When a certificate only has one SAN field and it contains a reference to a single website, then it&rsquo;s a single-domain certificate. If that one SAN field contains an asterisk in the website name (e.g. &lsquo;*.firstwebsite.com&rsquo;) then it&rsquo;s a wildcard certificate. If the certificate has many SAN fields, then it&rsquo;s a multi-domain certificate. Multi-domain certificates sometimes have 100 or more SAN fields, and some or all of these fields may contain wildcards, creating a hybrid &ldquo;multi-domain wildcard&rdquo; certificate like the example shown below!

{{< figure src="/uploads/2014/02/pros-and-cons.jpg" >}} 

Price is often the main concern in choosing between these options. If you have the need to secure more than one website, a multi-domain or wildcard certificate is usually more cost effective. However, there are a few other considerations that you should be aware of.

Wildcard SSL certificates can be used to secure an unlimited number of websites that are subdomains of the domain name in the certificate. This is convenient, but it also creates a potential risk. What if someone gained unauthorized access to your certificate&rsquo;s private key and used it to set up a rogue website that you didn&rsquo;t know about? For example, if your website is at https://secure.company.com, someone &ndash; even an employee &ndash; with access to that certificate could set up a site at https://secure1.company.com. That website would be difficult to detect and would have a perfectly valid SSL certificate giving it undeserved legitimacy. For this reason, wildcards are not allowed in Extended Validation certificates. Of course, if you feel that you have sufficient control over your certificate and understand the risks, a wildcard certificate may still be a good choice to simplify certificate management.

Multi-domain SSL certificates are popular and they don&rsquo;t expose the security risk of wildcard certificates that I described above, but they have some issues of their own. First, the more SAN fields you add to a certificate, the larger the certificate, and size impacts the performance of your website. Because the certificate has to be downloaded to the browser before any content is loaded, you should be especially sensitive to the size of the SSL certificate you use. A multi-domain certificate with 5 or 10 SANs may not make much difference, but one with 50 or 100 is likely to have a big impact on performance.

A second issue with multi-domain certificates occurs when they are used to secure websites belonging to different organizations. This is commonly done by Content Delivery Networks (CDNs) because it allows them to reduce their need for [scarce IP addresses][3]. However, if the certificate contains information identifying the organization, that information will be wrong because it can only identify one of the organizations &ndash; and often that one organization is the CDN operator rather than you.

Multi-domain certificates are often updated to add or remove websites. Each time a change is made, the certificate must be reissued and replaced on all the websites it protects. These changes can be risky and result in downtime for your websites.

A final risk that applies to both wildcard and multi-domain certificates is that you multiply the scope of any potential issues with the certificate. If the private key is stolen or the certificate expires, this problem now affects every site using the wildcard or multi-domain certificate rather than just one.

There are many cases where it makes sense or is even required to use a multi-domain or wildcard certificate. However, we encourage you to consider all of the tradeoffs when deciding which package to choose.

 [1]: https://casecurity.org/2013/08/07/what-are-the-different-types-of-ssl-certificates/
 [2]: https://kb.wisc.edu/page.php?id=18922
 [3]: http://en.wikipedia.org/wiki/IPv4_address_exhaustion
