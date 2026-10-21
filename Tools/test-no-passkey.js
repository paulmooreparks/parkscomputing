/* Keeps a test browser's passkey requests away from the operating system.
   The site asks for a passkey to sign in and to confirm a change (js/admin.js,
   js/accounts.js), and Chromium on Windows hands that to Windows Hello, whose
   dialog appears on the desktop even for a headless browser and waits for
   whoever is at the machine. Each page of the context is given a virtual
   authenticator instead, through the Chrome DevTools Protocol's WebAuthn
   domain, so a request is answered by the browser itself and fails at once
   when there is no passkey for it, as a cancelled request would.

     const noPasskeyPrompts = require('./test-no-passkey');
     const context = await browser.newContext(…);
     await noPasskeyPrompts(context);

   Chromium only; elsewhere it does nothing. */
'use strict';

module.exports = async function noPasskeyPrompts(context) {
    async function virtual(page) {
        try {
            const cdp = await context.newCDPSession(page);
            await cdp.send('WebAuthn.enable');
            await cdp.send('WebAuthn.addVirtualAuthenticator', {
                options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true }
            });
        } catch (err) { /* Not Chromium, or the page closed first. */ }
    }
    await Promise.all(context.pages().map(virtual));
    context.on('page', virtual);
};
