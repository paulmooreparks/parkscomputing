/* The desktop's background, which Settings keeps in ~/.config/desktop.json
   (js/config.js): the theme's own, a colour, or a picture from the home
   directory, read through the site filesystem (js/sitefs.js) and shown from
   a blob address. The window view (js/desktop.js), the split site's admin
   desktop (js/admin-desktop.js) and Settings' preview all draw it with this
   one function. */
(function () {
    'use strict';

    var IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
    var FIT = {
        fill: 'center / cover no-repeat', fit: 'center / contain no-repeat',
        center: 'center / auto no-repeat', tile: 'top left / auto repeat'
    };

    /* Draws s's background on el. Resolves to the picture's new blob
       address, or null, and lets oldUrl go. */
    async function paint(el, s, oldUrl) {
        var url = null, F = window.pcSiteFs;
        el.style.background = '';
        if (s.bgKind === 'color' && /^#[0-9a-f]{3,8}$/i.test(s.bgColor || '')) {
            el.style.background = s.bgColor;
        } else if (s.bgKind === 'image' && s.bgImage && F) {
            var n = F.resolve(F.home(), s.bgImage);
            var ext = String(s.bgImage).split('.').pop().toLowerCase();
            if (n && !n.children && IMAGE_TYPES[ext]) {
                try {
                    url = URL.createObjectURL(new Blob([await F.readBytes(n)], { type: IMAGE_TYPES[ext] }));
                    el.style.background = 'url("' + url + '") ' + (FIT[s.bgFit] || FIT.fill);
                } catch (err) { url = null; }
            }
        }
        if (oldUrl) { URL.revokeObjectURL(oldUrl); }
        return url;
    }

    window.pcDesktopBackground = paint;
})();
