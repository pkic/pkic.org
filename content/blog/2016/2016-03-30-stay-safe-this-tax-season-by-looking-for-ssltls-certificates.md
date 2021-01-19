---
title: Stay Safe This Tax Season by Looking for SSL/TLS Certificates
authors: [Ben Wilson]
date: 2016-03-30T16:05:39+00:00
dsq_thread_id:
  - 4705989891


---
It&#8217;s tax filing season again, and you need to be aware of scams that tried to steal your sensitive information or even your tax refund.  During 2015 the IRS blocked over 4.3 million suspicious returns and more than 1.4 million confirmed identity theft returns. <https://www.irs.gov/uac/Newsroom/IRS,-States-and-Tax-Industry-Combat-Identity-Theft-and-Refund-Fraud-on-Many-Fronts>.

Phishing emails, account compromise, identity theft, and fake websites are a few approaches used by cyber criminals this time of year.  Good computer security hygiene will usually protect you from someone else filing a tax return in your name.  Do not open attachments from people you do not know, do not click on links that take you to websites with malicious content, use good passwords, remember that the IRS does not communicate by email, and only use a recognized e-filing website when entering your sensitive personal information.  The IRS website is a good place to start.  The SSL/TLS URL for the IRS e-filing webpage is <https://www.irs.gov/Filing/E-File-Options>. Don’t go anywhere else&#8211;unless you have used a particular trusted e-filing provider in the past.  SSL/TLS Certificates help establish the identity of web sites you visit.  <https://casecurity.org/2013/11/22/how-organizations-are-authenticated-for-ssl-certificates/>

IRS-authorized e-filing services must meet minimum encryption standards and implement Extended Validation SSL/TLS Certificates.  <https://www.irs.gov/uac/Safeguarding-IRS-efile1>   Make sure that your connection to the website is encrypted with SSL/TLS (also known as HTTPS).  Look for the lock icon at the beginning of the URL address bar.  The IRS requires authorized e-filing services to implement Extended Validation (EV) certificates.  <https://casecurity.org/2014/03/25/when-to-choose-an-extended-validation-certificate/> The EV certificate provides an enhanced trust indicator in the address bar—displaying the legally recognized name of the owner of the website in green lettering.

In summary, always use good computer security hygiene, “know before you go” when filing your tax return online, and make sure you always use https whenever you conduct sensitive transactions online.  <https://casecurity.org/2016/02/03/moving-to-always-on-https-part-1-of-2-marking-http-as-unsecure/>.