# Reels-free Instagram: web version

A userscript that strips Reels out of instagram.com. It covers every step of the plan
that doesn't need the iOS app, and its `dist/blocker.js` and `dist/blocker.css` are exactly what the
iOS app injects later (Stage 3).

## Install

1. Install a userscript manager:
   - **Chrome, Edge, Firefox:** [Tampermonkey](https://www.tampermonkey.net/). In Chrome, also turn on
     "Allow user scripts" for it (chrome://extensions, Tampermonkey, Details).
   - **Safari on iPhone, iPad or Mac:** [Userscripts](https://apps.apple.com/app/userscripts/id1463298887) (free).
     This lets you try the blocker on your phone before the app exists.
2. Open the install link and confirm:
   **https://raw.githubusercontent.com/IhorBilyi/insta-block/main/web/dist/reels-blocker.user.js**
3. Open instagram.com. On a computer, Chrome's mobile emulation (DevTools, then the phone icon) shows the
   phone layout, which is what the app will load.

The script updates itself from that URL, so a fix pushed to `main` reaches you without reinstalling (Stage 5).

To look around without Instagram, open `dist/demo.html`: a pretend Instagram with the blocker running.

## What it does

| Plan stage | What you get |
|---|---|
| 1. Prototype | Reels tab, links and profile Reels tab hidden. `/reels/` sends you back to where you were. Suggested posts, suggested-account rows and reels in the home feed are hidden as they load. A reel sent in a DM plays, and swiping on to the next one takes you back to the chat. |
| 4. Feel like an app (web parts) | "Use the app" banners and pop-ups hidden. Optional messages-only mode opens straight into the inbox. |
| 5. Survive updates | Labels and selectors live in `src/rules.json`. The userscript auto-updates from GitHub. A settings panel has switches for Reels, Explore, suggested posts and Stories. |
| 6. Lock in the habit | Turning a block on is instant. Turning one off starts a 30-second countdown you can cancel. |

The parts of stages 2 to 4 that are native iOS (the WKWebView shell, external links in Safari, camera permissions,
app icon) are left for the app.

## Settings

Tap the small round button in the bottom right corner (or add `#reels-blocker` to the URL).

| Setting | Default |
|---|---|
| Block Reels | on |
| Let a single reel sent to me play | on |
| Hide reels in the home feed | on |
| Hide suggested posts | on |
| Hide Explore (on phones this also hides search) | off |
| Hide Stories | off |
| Hide "Use the app" banners | on |
| Open straight into messages | off |

Settings are saved in the browser for instagram.com. The iOS app can set its own defaults with
`window.__REELS_BLOCKER_CONFIG__` and replace the rules with `window.__REELS_BLOCKER_RULES__`
before injecting `blocker.js`.

## When Instagram changes something

1. Set `debug: true` in `DEFAULTS` in `src/blocker.js`, and watch the console for what gets hidden or blocked.
2. Fix the label or selector in `src/rules.json` or `src/blocker.css`. Only stable attributes are used
   (`href`, `aria-label`, `role`), never Instagram's class names.
3. Bump `version` in `package.json`, run `npm run build`, and push. Installed copies update themselves.

Suggested posts and app banners are found by their English labels. If Instagram is in another language,
add the translated labels to `src/rules.json`.

## Files

| Path | What it is |
|---|---|
| `src/blocker.css` | Hides the entry points |
| `src/blocker.js` | Route blocking, feed cleanup, settings and the unlock delay |
| `src/rules.json` | Labels and selectors, inlined at build time |
| `src/settings-panel.js` | The in-page settings panel (web only; the app gets a native screen) |
| `build.js` | Builds `dist/` |
| `dist/` | Built files: `reels-blocker.user.js`, `blocker.js`, `blocker.css`, `rules.json`, `demo.html` |
| `test/` | A mock Instagram and 41 end-to-end checks |

## Develop

```sh
cd web
npm run build   # rebuild dist/
npm test        # build, then run the checks (needs Playwright: npm i -D playwright && npx playwright install chromium)
```
