/**
 * The three names of this application, kept apart on purpose.
 *
 * `?` is illegal in Windows paths, registry keys and build artefact names, so the display name
 * never reaches anything but rendered text. See CLAUDE.md, "Namen (nicht verwechseln)".
 */

/** Reverse-DNS id. MUST stay identical to `appId` in electron-builder.yml, or Windows toasts
 *  fail silently: no error, no notification, and it never reproduces in dev. */
export const APP_ID = 'io.github.phish3144.watis'

/** Package name, directory under %LOCALAPPDATA%, log file names. Path-safe. */
export const APP_SLUG = 'watis'

/** Installer, Start Menu entry, program folder. MUST stay identical to `productName`. Path-safe. */
export const PRODUCT_NAME = 'WatIs'

/** Window title, about dialog, UI headings. The only string carrying the question mark. */
export const DISPLAY_NAME = 'WatIs?'

/** The one origin this app is allowed to host. */
export const WA_URL = 'https://web.whatsapp.com/'

export const WA_PARTITION = 'persist:wa'
