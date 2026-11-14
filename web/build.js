// Builds everything in dist/ from src/.
// Usage: node build.js
//
//   dist/blocker.js             blocker with rules inlined (what the iOS app injects)
//   dist/blocker.css            entry-point CSS (what the iOS app injects)
//   dist/rules.json             matching rules (for hosting / remote updates)
//   dist/reels-blocker.user.js  userscript: CSS + blocker + settings panel
//   dist/demo.html              mock Instagram with the userscript built in
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const { version } = require('./package.json');

const REPO_RAW = 'https://raw.githubusercontent.com/IhorBilyi/insta-block/main/web/dist';

const css = read('src/blocker.css');
const rules = JSON.parse(read('src/rules.json'));
delete rules._comment;
const blockerSrc = read('src/blocker.js');
if (!blockerSrc.includes('/*@RULES@*/ {}')) throw new Error('rules placeholder missing in blocker.js');
const blocker = blockerSrc.replace('/*@RULES@*/ {}', () => JSON.stringify(rules, null, 2).replace(/\n/g, '\n    '));
const panel = read('src/settings-panel.js');

const header = `// ==UserScript==
// @name         Reels-free Instagram
// @namespace    https://github.com/IhorBilyi/insta-block
// @version      ${version}
// @description  Hides Reels on instagram.com: removes the tab and links, blocks the /reels/ route, and cleans suggested posts and reels out of the feed.
// @match        https://www.instagram.com/*
// @match        https://instagram.com/*
// @run-at       document-start
// @grant        none
// @inject-into  page
// @updateURL    ${REPO_RAW}/reels-blocker.user.js
// @downloadURL  ${REPO_RAW}/reels-blocker.user.js
// ==/UserScript==
`;

const injectCss = `(function () {
  var css = ${JSON.stringify(css)};
  var style = document.createElement('style');
  style.id = 'reels-blocker-css';
  style.textContent = css;
  function add() {
    var parent = document.head || document.documentElement;
    if (!parent) return false;
    parent.appendChild(style);
    return true;
  }
  // At document start <html> may not exist yet; add the style as soon as it does.
  if (!add()) {
    var mo = new MutationObserver(function () { if (add()) mo.disconnect(); });
    mo.observe(document, { childList: true, subtree: true });
  }
})();
`;

const userscript = header + '\n' + injectCss + '\n' + blocker + '\n' + panel;

// The demo keeps the mock's "path" in the URL hash, so it works from any host.
const demoEnv = `<script>
window.__DEMO_HASH__ = true;
window.__REELS_BLOCKER_ENV__ = {
  path: function () { return location.hash.indexOf('#/') === 0 ? location.hash.slice(1) : '/'; },
  navigate: function (p) { history.replaceState(null, '', '#' + p); if (window.__mockRender) window.__mockRender(); },
  reload: function () { location.reload(); }
};
</script>
<script>
${userscript.replace(/<\/script>/gi, '<\\/script>')}
</script>`;

const demoBar = `<div class="demo-bar">
  <strong>Reels blocker demo.</strong> This is a pretend Instagram with the blocker running, so you can try it without logging in.
  <form id="demo-go"><input id="demo-path" aria-label="Address" autocomplete="off" spellcheck="false"><button>Go</button></form>
  <ul>
    <li>Type <code>/reels/</code> above and press Go: you land back where you were.</li>
    <li>Open Messages, then anna's reel: it plays. Swipe to the next one: you're back in the chat.</li>
    <li>The round button bottom right opens the settings. Turning something off takes 30 seconds.</li>
  </ul>
</div>`;

const mock = read('test/mock-instagram.html');
const demo = mock
  .replace('<title>Mock Instagram</title>', '<title>Reels Blocker Demo</title>')
  .replace('<!--DEMO_HEAD-->', () => demoEnv)
  .replace('<!--DEMO_BAR-->', () => demoBar);

const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const write = (f, s) => { fs.writeFileSync(path.join(dist, f), s); console.log('Wrote dist/' + f); };
write('blocker.js', blocker);
write('blocker.css', css);
write('rules.json', JSON.stringify(rules, null, 2) + '\n');
write('reels-blocker.user.js', userscript);
write('demo.html', demo);
