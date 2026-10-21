/* The account's background applet (Architecture/status-area-design.md): its
   item in the status area is the reader's avatar, PUDL's (0.74.0), their
   picture or their initials, and opens the Account applet. When the reader
   changes their picture there, js/account.js announces it with
   pc:account-picture, carrying the applet's avatar, and the item takes a
   small copy of it. It has no notifications yet; when it does, they are
   its count, as the moderation applet's are. */
pcStatus.register('account', {
    start: function (item) {
        'use strict';
        function onPicture(e) {
            var picture = e.detail && e.detail.picture;
            if (!picture || !picture.classList.contains('avatar')) { return; }
            var shown = picture.cloneNode(true);
            shown.classList.remove('lg', 'xl');
            shown.classList.add('sm');
            var old = item.el.querySelector('.avatar');
            if (old) { old.replaceWith(shown); } else { item.el.prepend(shown); }
            if (window.pudlFields) { window.pudlFields.enhance(shown); }
        }
        document.addEventListener('pc:account-picture', onPicture);
        return { stop: function () { document.removeEventListener('pc:account-picture', onPicture); } };
    }
});
