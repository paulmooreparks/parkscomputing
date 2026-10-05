/* The account's background applet (Architecture/status-area-design.md): its
   item in the status area is the reader's picture, or PUDL's account glyph
   when they have none, and opens the Account applet. When the reader
   changes their picture there, js/account.js announces it with
   pc:account-picture, carrying the applet's picture, and the item follows:
   a new picture replaces the glyph, and a removed one brings it back. It
   has no notifications yet; when it does, they are its count, as the
   moderation applet's are. */
pcStatus.register('account', {
    start: function (item) {
        'use strict';
        function glyph() {
            var g = document.createElement('span');
            g.className = 'glyph account-glyph';
            g.style.setProperty('--glyph', 'var(--glyph-account)');
            g.setAttribute('aria-hidden', 'true');
            return g;
        }
        function onPicture(e) {
            var picture = e.detail && e.detail.picture;
            if (!picture) { return; }
            var shown;
            if (picture.tagName === 'IMG') {
                shown = document.createElement('img');
                shown.className = 'account-avatar';
                shown.src = picture.getAttribute('src');
                shown.alt = '';
            } else {
                shown = glyph();
            }
            var old = item.el.querySelector('.account-avatar, .account-glyph');
            if (old) { old.replaceWith(shown); } else { item.el.prepend(shown); }
        }
        document.addEventListener('pc:account-picture', onPicture);
        return { stop: function () { document.removeEventListener('pc:account-picture', onPicture); } };
    }
});
