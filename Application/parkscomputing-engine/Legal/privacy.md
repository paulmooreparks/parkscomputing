---
title: Privacy policy
description: What Parks Computing keeps about you, why, for how long, and what you can do about it.
policyVersion: 2026-10-05
---

<!-- What this policy says the server keeps, and for how long, is what the
     code does; change them together. The account data is ExportAsync and
     DeleteAsync in Identity/AccountLifecycle.cs, the retention periods are
     HousekeepAsync there, and the research behind this text is
     Architecture/privacy-and-terms.md. -->

*Last updated 5 October 2026.*

Parks Computing is Paul Parks's website at parkscomputing.com: articles, books and a set of applets. Paul runs it as an individual in Singapore, and he decides what it does with your data. You can reach him about anything on this page at [paul@parkscomputing.com](mailto:paul@parkscomputing.com).

The site keeps as little about you as it can. It has no advertising, it doesn't track you across other sites, it doesn't sell your data, and it doesn't share your data with anyone except the services listed below, which it needs in order to work.

## If you don't sign in

Without an account, the server keeps nothing that identifies you. Your pins, the windows you have open, the width of the sidebar and any barcode layouts you save are stored in your own browser, and they stay there until you clear the site's data.

The server still sees each request your browser makes, as every web server does. It doesn't keep an access log. To stop any one visitor from overloading the site, it counts requests by IP address in memory, and it forgets each count after a few minutes.

The site counts page views with Plausible Analytics. Plausible uses no cookies and stores nothing in your browser. It works out your browser, operating system and country from your request and then discards your IP address and browser details; to count you once a day, it uses a code made from them that it can't reverse and that changes every 24 hours.

The server records errors in a log that is limited in size, so old entries are discarded as new ones arrive. It doesn't record IP addresses or email addresses there.

## If you have an account

An account lets you comment on articles, and keeps your pins the same on every device. For each account the server keeps the following.

- A random account number and the date the account was created.
- Your email address, which is never shown to anyone, and whether you have confirmed it.
- The display name you choose, and your profile picture if you add one.
- Your passkeys, if you add any. The server keeps each passkey's public key and the name you give it. A passkey's private key never leaves your device.
- Your pins.
- A record of each browser you are signed in to: when the session started, when it was last used, and whether you signed in with an email link or a passkey.
- Your comments, every version of each one, and whether a moderator approved it.
- Any reports you make about other people's comments.
- The dates of the terms of use and of this policy that were current when you created the account.

## What is public

Your display name, your profile picture and the comments a moderator has approved are public: anyone reading an article can see them beside your comment. Everything else on the list above is seen only by you, and by Paul as the site's operator.

Every comment, and every edit to one, is read by a moderator before it appears. Until then, only you and the moderators can see it. If a moderator doesn't approve it, only you can see that.

## Signing in

Signing in with an email link sends your address to Resend, the service that delivers the site's email. The link works once and expires after 15 minutes. To stop the sign-in form from being used to flood someone's inbox, the server counts how many links each address and each IP address has asked for in the current hour. It stores those counts against a scrambled form of the address, and deletes them within an hour of the hour ending.

Creating an account and asking for a sign-in link include a check by Cloudflare Turnstile that you're a person. Turnstile looks at your browser and its request; Cloudflare's own privacy policy covers what it does with them.

## Cookies and browser storage

The site sets only the cookies it needs in order to work, and none of them track you.

- `__Host-pc-account` keeps you signed in. It is deleted when you close your browser, and the server ends the session sooner if you sign out or stop using it for a while.
- `__Host-pc-account-af` protects the site's forms from being sent by other sites. It is also deleted when you close your browser.

Everything else the site remembers is kept in your browser's local storage, which only this site can read.

## Services the site uses

- **Cloudflare** carries all traffic between your browser and the server, so it handles every request, including your IP address. Its Turnstile check runs when you create an account or ask for a sign-in link.
- **Resend**, in the United States, delivers sign-in and account emails. It receives your email address and the message. It also delivers the moderators' emails about comments waiting for review, which give counts and article titles but never the comments themselves.
- **Plausible Analytics**, in the European Union, counts page views as described above.

Some of these services keep data outside Singapore. The site uses them under their standard data protection terms, which require them to protect your data to a standard comparable to Singapore's.

## How long data is kept

Account data is kept until you delete the account. An account whose email address is never confirmed is deleted after seven days. Sign-in links, and the counts kept against them, are deleted within an hour of expiring. A session's record is deleted within an hour of the session ending.

When you withdraw a comment, its text is erased at once. When a moderator declines a comment or an edit, or removes a comment, its text is kept for 90 days for the moderation record and then erased. A report is deleted 90 days after a moderator has dealt with it.

Before an upgrade, the server's database is backed up. A backup is kept for at most 30 days, so an account you delete can remain in a backup until the backup is removed.

## Your choices

- **See and download your data.** Download your data, on the Account page, downloads everything the server keeps about your account, including every version of your comments.
- **Correct it.** You can change your display name, picture, passkeys and pins yourself on the Account page, and edit your comments under each article.
- **Withdraw a comment.** Withdraw, under any of your comments, erases its text at once.
- **Delete it.** On the Account page you can delete your account. The site first emails you a link to confirm. Deleting removes your email address, passkeys, sessions, pins and picture, and erases the text of your comments; where someone replied to one, a note says it was withdrawn. The copies in your own browser stay until you clear the site's data.

For anything else, or to ask what the site holds about you, write to [paul@parkscomputing.com](mailto:paul@parkscomputing.com). You'll get an answer within 30 days. If you think the site has mishandled your data, you can complain to Singapore's Personal Data Protection Commission, or to the data protection authority where you live.

## Security

All traffic is encrypted. Sign-in links are stored only in scrambled form, so a copy of the database can't be used to sign in as you. If a breach puts your data at risk, the site will tell you and the Personal Data Protection Commission as the law requires.

## Children

Accounts are for people aged 13 and over. Please don't create an account if you are under 13.

## Changes

If this policy changes, the date at the top changes with it. A change that affects how your account data is used will be announced on the site before it takes effect.

The [terms of use](/terms) cover the rest of your use of the site.
