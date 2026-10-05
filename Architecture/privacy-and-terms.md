# Privacy notice and terms of use

Paul asked on 2026-10-05 for a privacy notice and terms of use that fit Singapore, where he is based, and the GDPR, before public sign-up opens with comments (`unified-identity-design.md`, step 2). This document records what the law asks of the site, what the site actually does with personal data, the defaults proposed where Paul has not yet decided, and the facts only he can supply. It is research, not legal advice; the texts drafted from it should be read by a Singapore lawyer before the site relies on them.

The research was done on 2026-10-05 from primary sources where they could be reached: Singapore Statutes Online for the PDPA, its regulations, OSRAA, POFMA, the Protection from Harassment Act, the Electronic Transactions Act and the Spam Control Act; PDPC's advisory guidelines; the EDPB's guidelines on territorial scope and on Article 3 and Chapter V; the ICO's guidance; and the Resend, Cloudflare and Plausible documents named below. EUR-Lex refused automated retrieval, so statements of the GDPR's own text that rest on secondary sources are marked as unconfirmed.

## What the law asks

### Singapore's PDPA

The PDPA applies to any organisation, and an individual counts as one, except an individual acting in a personal or domestic capacity (s4(1)(a)). PDPC reads personal capacity as activities for the individual's own purposes. A public site where strangers open accounts and post comments serves other people, so the site should comply as an organisation. No PDPC decision on a personal site with member accounts was found, so this is a reading, not a ruling.

The obligations that shape the notice and the site's practice:

- **Purposes and notice.** The purposes must be stated on or before collection (s20), with a business contact who can answer questions. Data is used only for purposes a reasonable person would think appropriate and that were notified (s18). Consent cannot be made a condition of the service beyond what the service reasonably needs (s14), and it can be withdrawn, with the consequences explained (s16).
- **Access and correction.** A written request for access is answered as soon as reasonably possible, with what the site holds and how it was used or disclosed in the past year (s21). If that takes more than 30 days the requester is told within 30 days when to expect it (reg 5). An access fee is allowed only after a written estimate; correction is free (reg 7).
- **Protection and retention.** Reasonable security (s24), and no keeping data once its purpose is served and no legal or business need remains (s25). PDPC says data must not be kept "just in case".
- **Overseas transfers.** Data may leave Singapore only with comparable protection, through legally enforceable obligations or a recognised certification (s26, regs 10 to 12). A contract used for this must name the countries the data may go to (reg 11(2)). Contractual necessity is a fallback (reg 10(2)(b)).
- **Breach notification.** A breach is assessed promptly. It is notifiable when it is likely to cause significant harm or affects 500 or more people; an account identifier exposed with anything that grants access counts as significant harm. A notifiable breach is reported to PDPC within 3 calendar days of the assessment, and affected people are told (ss26B to 26D, Notification of Data Breaches Regulations 2021).
- **Accountability.** Someone is designated responsible for compliance and their business contact is published, at least an email or postal address reachable from Singapore in business hours (s11(3) and (5), reg 1A as amended from 1 September 2026). Nothing in the Act stops Paul designating himself. Written policies and a complaints process are expected (s12).
- **Portability.** Part 6B is referred to but not in force.
- **Children.** PDPC treats 13 as the age from which a minor can usually consent, if the notice is written so a teenager can understand it; below 13 a parent consents (2024 children's guidelines). A contract made by someone under 18 has full effect only from 18, so the terms bind younger members less reliably.

### Comments under other Singapore law

- **OSRAA 2025**, in force from 29 June 2026, makes anyone who moderates an online location an administrator. A victim of online harm (harassment, doxxing, intimate image abuse and the other harms of its first phase) can send an online harm notice, which the administrator must assess and act on within a reasonable time (s91), and the Online Safety Commission can direct any administrator (s26). Moderation policy is a factor in the tort of facilitating harm, and reasonable conduct is a defence (s90). The heavier duties fall on large platforms, not on a site this size.
- **POFMA.** A site that lets readers publish comments is arguably an internet intermediary, which can be directed to show a correction or disable access (ss21 and 22); not complying without reasonable excuse is an offence.
- **Protection from Harassment Act.** A court can order an online location's administrator to stop publishing, correct or disable content.
- **Defamation.** The Electronic Transactions Act shields providers who merely give access. A site that approves every comment before it appears is unlikely to be one, so a moderator who approves a defamatory comment may share responsibility for it. This is a reading, not checked against the common-law cases.
- **Spam Control Act** covers commercial messages. Sign-in, verification and security emails are not commercial, so it does not apply unless the site later sends newsletters or promotion.
- The Broadcasting Act's online safety codes apply only to designated large services.

### GDPR and UK GDPR

A site outside the EU falls within the GDPR when it envisages offering goods or services to people in the EU; being reachable from the EU is not enough (Recital 23, EDPB Guidelines 3/2018). A free service counts as an offer. The EDPB's own example of a non-EU controller that does not target the EU, receiving data directly from an EU resident, concludes that the GDPR does not apply (Guidelines 05/2021, example 3). The site therefore treats itself as outside the GDPR's scope and avoids targeting signals such as EU languages or currencies or addressing EU readers, while its notice still says everything Article 13 would ask, since the PDPA asks for most of it anyway. If that ever changes, the Article 27 exemption from appointing an EU representative would probably not apply, because account processing is regular, not occasional.

On storage in the browser, session and security cookies are exempt from consent in both the EU and the UK. The UK exempts preference storage such as a theme, provided the reader is told and can object; the EU exempts it for the short term. A persistent sign-in cookie is not exempt in the EU.

California's CCPA applies only to businesses far larger than this site.

## What the site does with personal data

These facts come from the code on 2026-10-05 and should be checked again whenever a feature changes.

| Data | Where it is kept | Public? | Why |
|---|---|---|---|
| Email address | Accounts database | No | Signing in, verification and security messages |
| Display name | Accounts database | Yes, beside comments | Attribution |
| Profile picture | Accounts database | Yes, beside comments and in the top bar | Attribution |
| Passkeys (public keys and names) | Accounts database | No | Signing in |
| Sessions (start time, last use, sign-in method) | Accounts database | No | Keeping a member signed in and letting them end sessions |
| Pins | Accounts database when signed in, otherwise the browser | No | The Pins bar |
| Comments, their versions and their moderation history | Accounts database | Approved text, yes | The discussion |
| Reports and their reasons | Accounts database | No | Moderation |
| Hashed email address and hashed IP address, by hour | Accounts database (email limits) | No | Limiting how many emails are sent |

The site stores no IP address or user agent with a session or a comment. The email limits keep an unsalted SHA-256 of the address and of the IP address in hourly buckets, which is pseudonymous rather than anonymous, since an IPv4 address can be recovered from its hash by trying them all; these buckets are deleted within an hour of the hour they count ending. The sign-in and antiforgery cookies are session cookies: the site never asks for a persistent sign-in (`isPersistent: false`), so the EU's concern about persistent login cookies does not arise. The browser also keeps the reader's own preferences in local storage (`pc-windows`, `pc-sidebar-w`, `pc-focus`, `pc-pins` when not signed in, and saved barcode layouts), none of which is sent to the server.

A profile picture is redrawn in the browser before it is sent, which drops its metadata, such as where a photo was taken. A picture sent without script arrives as it was, metadata included, after a check that it is an image.

Others who handle personal data for the site:

- **Resend** (United States) sends the sign-in and verification emails, so it receives the email address and the message. Its data processing addendum covers the GDPR, the UK GDPR and the CCPA, with the 2021 standard contractual clauses and EU-US Data Privacy Framework certification, but does not mention Singapore or name the countries data may go to. For the PDPA the site relies on contractual necessity: an email sign-in cannot work without sending the email.
- **Cloudflare** carries every request through its tunnel and terminates TLS, so it sees IP addresses and the traffic. Cloudflare says it holds Global CBPR and Global PRP certifications, which would satisfy the PDPA's transfer rules; that is the company's own claim and should be checked on the Global CBPR registry. Turnstile, once added, is Cloudflare's too.
- **Plausible** counts page views on every page. Its data policy says it uses no cookies or local storage, does not store IP addresses or user agents, identifies a visitor for one day by hashing the IP address and user agent with a salt deleted every 24 hours, and keeps its data in the EU.
- The accounts database and its backups are on Paul's own machine in Singapore. A backup copied to cloud storage would be one more overseas transfer.

## Decisions, following YAVCHN

Paul asked on 2026-10-05 that YAVCHN's privacy policy and terms of use, and where they are placed, guide these ones where they make sense. They do, and the site follows them in these ways.

- **The texts are part of the application.** YAVCHN renders them from its own templates, beside the code they describe, so a change to what the server keeps and a change to what the policy says land together. Here they are `Application/parkscomputing-engine/Legal/privacy.md` and `terms.md`, copied into the build, shown at `/privacy` and `/terms` and as windows of the same names (`Identity/PolicyDocuments.cs`). They are not content files, because beta reads the live tree, which is production's, and a content file would reach production the moment beta could see it.
- **They are linked from the Help menu and the footer.** YAVCHN puts them at the end of its Help menu, after a separator, and in its About dialog. Here the classic footer carries both links, and the Help menu in `sitenav.xfer` ends with them after a separator. Both went to production on 2026-10-05, ahead of comments and public sign-up, at Paul's request.
- **Accepting the terms is a sentence, not a checkbox.** Creating an account says that it accepts the terms and that the reader is 13 or over, with a link to the privacy policy, as YAVCHN's sign-in does. The versions in force are recorded on the account. A later change moves the date at the top of the text, is announced on the site, and is accepted by continuing to use it; the site does not stop a member commenting to agree again.
- **Plain, first-person-site prose,** in YAVCHN's order: who runs the site, what it keeps without an account and with one, what is public, signing in, cookies, services, retention, choices, security, children, changes.
- **The facts YAVCHN settled apply here too.** Paul runs the site as an individual in Singapore; the contact for privacy and complaints is paul@parkscomputing.com; accounts are for people aged 13 and over; a request is answered within 30 days; database backups are kept for at most 30 days (`Tools/prune-backups.sh`, run with each deploy); Singapore law governs.
- **Short-lived records go within an hour of ending,** as YAVCHN's do: sign-in links, the hashed email-limit counts and session records. An unverified sign-up goes after seven days. The text of a declined, spam or removed comment is kept 90 days for the moderation record, and a settled report 90 days, then both go. A withdrawn comment's text goes at once.
- **Reports are answered within seven days,** sooner for intimate images, threats or someone's personal details, and anyone may write in, member or not, which serves as the channel for OSRAA's online harm notices.
- **The GDPR posture** described above: outside its scope, with a policy complete enough that it would not need rewriting if that changed.

## Still open

1. The policy promises an error log limited in size. Production's container log has no limit today, so `docker-compose.yml` needs a size cap on its logging (for example `max-size: 10m`, `max-file: 3`) before the policy is published. Compose changes are Paul's to approve.
2. How long Resend keeps its sending logs on Paul's plan, and whether any Cloudflare logging or analytics beyond the tunnel is switched on. Neither changes the text unless the answer is surprising.
3. Cloudflare's Global CBPR certification should be checked on the registry, since the policy relies on it for transfers.
