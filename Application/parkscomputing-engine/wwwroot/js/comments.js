/* The comments applet (Architecture/unified-identity-design.md, step 2):
   an article's discussion under the article, in both views, and on the
   discussion's own page, /comments/{slug}. The server draws the panel for
   the reader asking (Pages/Shared/_DiscussionContent.cshtml); this loads it
   into a mount that arrives empty, and posts its forms in place, so the
   reader stays on the article. Each form also works without script, as a
   plain post to the discussion's page. */
(function () {
    'use strict';

    function panelOf(html) {
        return new DOMParser().parseFromString(html, 'text/html').querySelector('[data-discussion-panel]');
    }

    /* Brings a comment into view and marks it for a moment. */
    function reveal(item) {
        item.scrollIntoView({ block: 'center', behavior: 'smooth' });
        item.classList.remove('comment-flash');
        void item.offsetWidth;
        item.classList.add('comment-flash');
    }

    /* The article's Comments link (Pages/Shared/_TagRow.cshtml) shows how
       many anyone can read; once the discussion has loaded it says what the
       panel says, on this page and, for a framed article, in the window
       around it. */
    function recount(root) {
        var panel = root.querySelector('[data-discussion-panel]');
        if (!panel || !panel.hasAttribute('data-count')) { return; }
        var slug = root.dataset.discussion, n = panel.getAttribute('data-count');
        var docs = [document];
        try { if (window.parent !== window && window.parent.document) { docs.push(window.parent.document); } } catch (err) { /* not this site's */ }
        docs.forEach(function (d) {
            d.querySelectorAll('a[data-comments-link="' + CSS.escape(slug) + '"] [data-comments-count]').forEach(function (c) { c.textContent = n; });
        });
    }

    function load(root) {
        var slug = root.dataset.discussion;
        return fetch('/comments/' + encodeURIComponent(slug) + '?handler=Applet', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'text/html' } })
            .then(function (r) { if (!r.ok) { throw new Error(r.status); } return r.text(); })
            .then(function (html) {
                var panel = panelOf(html);
                if (panel && root.isConnected) {
                    root.replaceChildren(document.importNode(panel, true)); if (window.pudlFields) { window.pudlFields.enhance(root); }
                    recount(root);
                    // An address that names a comment (#c-…) shows it once the
                    // discussion has arrived.
                    var named = /^#c-[0-9a-f-]+$/i.test(location.hash) && root.querySelector(location.hash);
                    if (named) { reveal(named); }
                }
            })
            .catch(function () {
                if (root.isConnected && !root.querySelector('[data-discussion-panel]')) {
                    root.innerHTML = '<p class="form-help">The comments could not be loaded. <a href="/comments/' + encodeURIComponent(slug) + '">Open them as a page</a>.</p>';
                }
            });
    }

    /* Asks before withdrawing, since the text is deleted for good. */
    function confirmWithdraw() {
        return new Promise(function (resolve) {
            var dialog = document.createElement('dialog');
            dialog.className = 'dialog';
            dialog.setAttribute('aria-labelledby', 'pc-withdraw-title');
            dialog.innerHTML =
                '<h2 class="dialog-title" id="pc-withdraw-title">Withdraw this comment?</h2>' +
                '<p>Its text is deleted and can’t be brought back. Replies to it stay, under a note that it was withdrawn.</p>' +
                '<div class="dialog-actions"><button class="btn" type="button" value="no" autofocus>Keep it</button>' +
                '<button class="btn btn-danger" type="button" value="yes">Withdraw</button></div>';
            dialog.addEventListener('click', function (e) {
                var b = e.target.closest('button[value]');
                if (b) { dialog.close(b.value); }
            });
            dialog.addEventListener('close', function () { dialog.remove(); resolve(dialog.returnValue === 'yes'); });
            document.body.appendChild(dialog);
            dialog.showModal();
        });
    }

    pudlApplets.register('comments', {
        init: function (root) {
            if (!root.dataset.discussion) { return { destroy: function () { } }; }
            if (!root.querySelector('[data-discussion-panel]')) { load(root); }

            async function send(form, retried) {
                var r = await fetch(form.action, { method: 'POST', body: new FormData(form), credentials: 'same-origin', headers: { Accept: 'text/html' } });
                // The session ended while the page was open: sign in again,
                // with a token for the new session, and send it once more.
                if ((r.status === 401 || r.status === 400) && !retried && window.pcAccounts) {
                    var now = await window.pcAccounts.freshToken();
                    if (!now.signedIn) { await window.pcAccounts.signIn(); now = await window.pcAccounts.freshToken(); }
                    var field = form.querySelector('input[name="__RequestVerificationToken"]');
                    if (field && now.token) { field.value = now.token; }
                    return send(form, true);
                }
                var panel = panelOf(await r.text());
                if (!panel) { throw new Error('no panel'); }
                if (!root.isConnected) { return; }
                root.replaceChildren(document.importNode(panel, true)); if (window.pudlFields) { window.pudlFields.enhance(root); }
                recount(root);
                var said = root.querySelector('[data-discussion-error], .notice');
                if (said) { said.setAttribute('tabindex', '-1'); said.focus(); }
            }

            async function onSubmit(e) {
                var form = e.target;
                if (!root.contains(form) || !form.closest('[data-discussion-panel]')) { return; }
                e.preventDefault();
                if (form.hasAttribute('data-comment-withdraw') && !(await confirmWithdraw())) { return; }
                var button = form.querySelector('[type="submit"]');
                if (button) { button.disabled = true; }
                try { await send(form, false); }
                catch (err) {
                    // Signing in was cancelled, or the site could not be
                    // reached: leave the form as it was, text and all.
                    if (button) { button.disabled = false; }
                }
            }

            /* A comment's date is its address, for a new tab or for sharing.
               A plain press keeps the reader where they are, in a window or
               on the page, and shows that comment; on the discussion's own
               page the address follows. */
            function onClick(e) {
                var link = e.target.closest && e.target.closest('a.comment-when');
                if (!link || !root.contains(link) || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) { return; }
                var item = link.closest('.comment');
                if (!item) { return; }
                e.preventDefault();
                reveal(item);
                if (location.pathname === new URL(link.href).pathname) { history.replaceState(history.state, '', '#' + item.id); }
            }

            root.addEventListener('submit', onSubmit);
            root.addEventListener('click', onClick);
            return {
                destroy: function () { root.removeEventListener('submit', onSubmit); root.removeEventListener('click', onClick); }
            };
        }
    });
})();
