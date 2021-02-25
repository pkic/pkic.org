---
authors:
- Dean Coclin
date: "2015-11-10T16:20:14+00:00"
dsq_thread_id:
- 4306254477
keywords:
- qualified
- chrome
- root program
- eidas
- webtrust
tags:
- Qualified
- Chrome
- Root Program
- eIDAS
- WebTrust
title: CA/B Forum Istanbul 2015


---
While some face to face meetings can be rather mundane and boring, that can’t be said about October’s CA/B Forum meeting in Istanbul, Turkey.  Guest speaker Andrea Servida from the European Commission gave an overview of the new eIDAS regulation on electronic identification and trust services. While not everyone in the room agreed with his points, all were made aware that this has now become the law in the EU and certificate authorities which plan to issue the new EU Qualified website certificates must comply with it. Unfortunately, the law appears to make it a requirement that the Certificate Authority (or Trust Service Provider-TSP as spelled out in the regulation) must be based in the EU or in a country that has an agreement with the EU. This could limit CA choices for EU website owners to only smaller CAs located in the EU, and potentially drive up certificate prices. A link to Mr. Servida’s presentation is here: <https://cabforum.org/wp-content/uploads/eIDAS-Istanbul-Servida.pdf>

Other hot topics included the upcoming SHA-1 deprecation deadlines which in light of new academic research, was very timely. It appears that very large corporations and governments are having difficulty meeting the December 2015 deadline where CAs will no longer be able to issue SHA-1 certificates (although existing certificates will be valid until December 2016). The problem relates to the large number of servers along with a separate issue relating to non-browser environments that don’t support SHA-2. In addition, some browsers are considering bringing in the date where they will no longer trust SHA-1 certificates to mid-year 2016. While a lengthy discussion ensued, the group could not agree on making any changes to the current situation.

On the browser front, Google announced it will be taking the certificate details tab out of the user interface and moving it to the developer console. The impetus for this is research which shows that most users don’t understand it. We can expect this possibly in Chrome version 48.

Microsoft is starting to remove roots from CAs that have not signed their new Root Program Agreement. Surprisingly this represents about 63 roots! Microsoft said that some CAs have not responded to their communication while others have audit issues. It will be interesting to see what the final number of roots removed is when this takes place in November.

Further discussions on EV Wildcards, short lived certificates, ETSI and WebTrust audits and changes to cert validity periods were held. A complete set of minutes can be found here: <https://cabforum.org/2015/10/07/2015-10-07-face-to-face-meeting-minutes-meeting-36-istanbul/>.

Who will be the next guest speaker? Stay tuned for the next meeting in Scottsdale next February.