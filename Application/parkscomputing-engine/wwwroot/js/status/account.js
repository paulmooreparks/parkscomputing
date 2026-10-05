/* The account's background applet (Architecture/status-area-design.md): its
   item in the status area is the reader's picture, which opens the Account
   applet. When the reader changes their picture there, js/account.js
   announces it with pc:account-picture, carrying the new picture, and the
   item shows it. It has no notifications yet; when it does, they are its
   count, as the moderation applet's are. */
pcStatus.register('account', {
    start: function (item) {
        'use strict';
        function onPicture(e) {
            var picture = e.detail && e.detail.picture;
            if (!picture) { return; }
            var copy = picture.cloneNode(true);
            copy.classList.remove('account-avatar-large');
            var old = item.el.querySelector('.account-avatar');
            if (old) { old.replaceWith(copy); } else { item.el.prepend(copy); }
        }
        document.addEventListener('pc:account-picture', onPicture);
        return { stop: function () { document.removeEventListener('pc:account-picture', onPicture); } };
    }
});
