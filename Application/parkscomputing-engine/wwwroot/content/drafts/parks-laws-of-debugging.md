---
title: Parks' Laws of Debugging
description: Laws of debugging I live by
date: 2025-08-25T22:49:22+08
lastModified: 2025-08-25T22:49:22+08
commentsAllowed: false
commentsEnabled: false
lang: en-us
---

# Parks' Laws of Debugging

Over my life as a software developer, I've collected several rules of thumb that guide me in my work, but these two "laws" have been remarkably useful. Like a lot of popular, so-called laws in software development, they aren't scientifically proven so aren't really laws, but they have held up so many times that I assume they're true until proven otherwise.

These laws weren't formulated overnight; instead, they are reminders of hard lessons learned in the trenches.

## Parks' First Law of Debugging

> For any given defect report, there is always more than one bug in play. Fixing the first bug you find will not automatically resolve the defect.

When a customer reports a serious bug in your software and is chasing your team for a fix, you're inclined to want to fix it as quickly as possible. As soon as you find The Bug and apply a fix, you may experience a sort of tunnel vision, where you convince yourself that the bug really is fixed and it's time to ship the fix. This law reminds you that software is complex, and it can behave in unexpected ways.

(Need an example here)

## Parks' Second Law of Debugging

> If you cannot reproduce a bug in a controlled environment, then for the purposes of debugging the bug does not exist.

My QA teams always hated this law. If they reported a bug
