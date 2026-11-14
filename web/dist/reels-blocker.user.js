// ==UserScript==
// @name         Reels-free Instagram
// @namespace    https://github.com/IhorBilyi/insta-block
// @version      0.2.0
// @description  Hides Reels on instagram.com: removes the tab and links, blocks the /reels/ route, and cleans suggested posts and reels out of the feed.
// @match        https://www.instagram.com/*
// @match        https://instagram.com/*
// @run-at       document-start
// @grant        none
// @inject-into  page
// @updateURL    https://raw.githubusercontent.com/IhorBilyi/insta-block/main/web/dist/reels-blocker.user.js
// @downloadURL  https://raw.githubusercontent.com/IhorBilyi/insta-block/main/web/dist/reels-blocker.user.js
// ==/UserScript==

(function () {
  var css = "/*\n * Reels blocker: entry points.\n * Only stable attributes are targeted (href patterns, aria-label, role),\n * never Instagram's obfuscated class names.\n */\n\n/* Reels tab in the bottom bar (mobile) and the side nav (desktop). */\na[href=\"/reels/\"],\na[href^=\"/reels/\"],\na[href^=\"https://www.instagram.com/reels/\"],\na:has(svg[aria-label=\"Reels\"]),\n[role=\"link\"]:has(svg[aria-label=\"Reels\"]) {\n  display: none !important;\n}\n\n/* The \"Reels\" tab on profile pages (/<user>/reels/). */\na[href$=\"/reels/\"][role=\"tab\"],\na[role=\"tab\"][href*=\"/reels/\"] {\n  display: none !important;\n}\n\n/* Items marked by blocker.js (feed posts, suggestion rows). */\n[data-reels-blocker-hidden] {\n  display: none !important;\n}\n\n/* Optional: Explore. Enabled when blocker.js sets this flag on <html>. */\nhtml[data-reels-blocker-explore] a[href=\"/explore/\"],\nhtml[data-reels-blocker-explore] a:has(svg[aria-label=\"Explore\"]),\nhtml[data-reels-blocker-explore] a:has(svg[aria-label=\"Search & Explore\"]) {\n  display: none !important;\n}\n\n/* Optional: \"Get the app\" links and banners (Stage 4). */\nhtml[data-reels-blocker-banners] a[href*=\"apps.apple.com\"],\nhtml[data-reels-blocker-banners] a[href*=\"itunes.apple.com\"],\nhtml[data-reels-blocker-banners] a[href*=\"play.google.com\"] {\n  display: none !important;\n}\n";
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

/*
 * Reels blocker: runtime logic.
 *
 * Runs at document start, in the page's own context (not a sandbox), so that
 * wrapping history.pushState affects Instagram's router.
 *
 *   1. Hide the entry points (CSS does most of it; clicks are also intercepted).
 *   2. Block the route: /reels/... sends you back to where you were (or home).
 *   3. Clean the page as it loads: suggested posts, reel posts in the feed,
 *      and optionally the Stories tray and "Use the app" banners.
 *
 * A single reel someone sends you (/reel/<id>/) is allowed. Moving on from it
 * to another reel is blocked and sends you back to where you opened it from.
 *
 * Settings come from, lowest priority first: DEFAULTS below,
 * window.__REELS_BLOCKER_CONFIG__ (set by a host app before this file runs),
 * and the choices saved from the settings panel. Loosening a block only takes
 * effect after unlockDelaySeconds (Stage 6 friction); tightening is instant.
 *
 * Matching rules (labels, selectors) live in rules.json and are inlined at
 * build time. A host app can replace them with window.__REELS_BLOCKER_RULES__.
 */
(function () {
  'use strict';

  if (window.__reelsBlocker) return;

  // ------------------------------------------------------------- settings

  var SETTINGS = [
    { key: 'blockReels', label: 'Block Reels', def: true, strict: true },
    { key: 'allowSingleReel', label: 'Let a single reel sent to me play', def: true, strict: false },
    { key: 'hideReelPostsInFeed', label: 'Hide reels in the home feed', def: true, strict: true },
    { key: 'hideSuggested', label: 'Hide suggested posts', def: true, strict: true },
    { key: 'hideExplore', label: 'Hide Explore', note: 'On phones this also hides search', def: false, strict: true },
    { key: 'hideStories', label: 'Hide Stories', def: false, strict: true },
    { key: 'hideAppBanners', label: 'Hide "Use the app" banners', def: true, strict: true },
    { key: 'messagesOnly', label: 'Open straight into messages', def: false, strict: true }
  ];

  var DEFAULTS = { unlockDelaySeconds: 30, debug: false };
  SETTINGS.forEach(function (s) { DEFAULTS[s.key] = s.def; });

  var RULES = Object.assign(
    {
      "suggestedLabels": [
        "Suggested for you",
        "Suggested posts",
        "Suggested reels",
        "Suggested threads"
      ],
      "reelPostSelectors": [
        "a[href*=\"/reel/\"]",
        "a[href*=\"/reels/\"]",
        "svg[aria-label=\"Reels\"]",
        "svg[aria-label=\"Reel\"]",
        "svg[aria-label=\"Clip\"]"
      ],
      "appBannerLabels": [
        "Open app",
        "Open in app",
        "Use the app",
        "Use app",
        "Open Instagram",
        "Get the app"
      ],
      "storyLinkSelectors": [
        "a[href^=\"/stories/\"]:not([href^=\"/stories/highlights/\"])"
      ]
    },
    window.__REELS_BLOCKER_RULES__ || {}
  );

  // Where the page is and how to move it. A demo page can swap these out.
  var env = Object.assign({
    path: function () { return location.pathname; },
    navigate: function (p) { location.replace(p); },
    reload: function () { location.reload(); }
  }, window.__REELS_BLOCKER_ENV__ || {});

  var KEY = {
    settings: 'reelsBlocker.settings',
    pending: 'reelsBlocker.pending',
    safePath: 'reelsBlocker.lastSafePath',
    launched: 'reelsBlocker.launched'
  };

  // Storage can be blocked (private windows, sandboxed pages); fall back to memory.
  var memory = {};
  function load(store, key, fallback) {
    var raw;
    try { raw = window[store].getItem(key); } catch (e) { raw = memory[store + key]; }
    try { return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
  }
  function save(store, key, value) {
    var raw = JSON.stringify(value);
    memory[store + key] = raw;
    try { window[store].setItem(key, raw); } catch (e) { /* kept in memory */ }
  }

  var hostConfig = window.__REELS_BLOCKER_CONFIG__ || {};
  var config;

  function computeConfig() {
    config = Object.assign({}, DEFAULTS, hostConfig, load('localStorage', KEY.settings, {}));
  }

  // Moves pending changes whose wait is over into saved settings.
  function applyDue() {
    var pending = load('localStorage', KEY.pending, {});
    var saved = load('localStorage', KEY.settings, {});
    var now = Date.now();
    var changed = false;
    Object.keys(pending).forEach(function (k) {
      if (pending[k].at <= now) {
        saved[k] = pending[k].value;
        delete pending[k];
        changed = true;
      }
    });
    if (changed) {
      save('localStorage', KEY.settings, saved);
      save('localStorage', KEY.pending, pending);
      computeConfig();
    }
    return changed;
  }

  function settingFor(key) {
    for (var i = 0; i < SETTINGS.length; i++) if (SETTINGS[i].key === key) return SETTINGS[i];
    return null;
  }

  // Tightening applies now; loosening waits unlockDelaySeconds.
  // Returns { applied: true } or { applied: false, at: <ms timestamp> }.
  function requestChange(key, value) {
    var s = settingFor(key);
    if (!s) throw new Error('Unknown setting ' + key);
    var pending = load('localStorage', KEY.pending, {});
    delete pending[key];
    if (value === config[key] || value === s.strict) {
      save('localStorage', KEY.pending, pending);
      if (value !== config[key]) {
        var saved = load('localStorage', KEY.settings, {});
        saved[key] = value;
        save('localStorage', KEY.settings, saved);
        computeConfig();
      }
      return { applied: true };
    }
    var at = Date.now() + config.unlockDelaySeconds * 1000;
    pending[key] = { value: value, at: at };
    save('localStorage', KEY.pending, pending);
    return { applied: false, at: at };
  }

  function cancelPending(key) {
    var pending = load('localStorage', KEY.pending, {});
    delete pending[key];
    save('localStorage', KEY.pending, pending);
  }

  applyDue();
  computeConfig();

  var HIDDEN_ATTR = 'data-reels-blocker-hidden';

  function log() {
    if (config.debug) console.log.apply(console, ['[reels-blocker]'].concat([].slice.call(arguments)));
  }

  // ---------------------------------------------------------------- routing

  function isReelsPath(p) { return /^\/reels(\/|$)/.test(p); }
  function reelId(p) { var m = /^\/reel\/([^/]+)/.exec(p); return m ? m[1] : null; }
  function isExplorePath(p) { return /^\/explore(\/|$)/.test(p); }
  function isStoryPath(p) { return /^\/stories\//.test(p) && !/^\/stories\/highlights\//.test(p); }

  function isBlocked(p) {
    if (config.blockReels && isReelsPath(p)) return true;
    if (config.blockReels && !config.allowSingleReel && reelId(p)) return true;
    if (config.hideExplore && isExplorePath(p)) return true;
    if (config.hideStories && isStoryPath(p)) return true;
    return false;
  }

  var lastPath = null;     // path we last checked
  var allowedReel = null;  // id of the one reel currently allowed

  function bounce(reason) {
    var p = env.path();
    var target = load('sessionStorage', KEY.safePath, '/');
    if (target === p || isBlocked(target) || reelId(target)) target = '/';
    log('blocked', p, '(' + reason + ') ->', target);
    lastPath = null;
    env.navigate(target);
  }

  function checkRoute() {
    var p = env.path();
    if (p === lastPath) return;
    var prev = lastPath;
    lastPath = p;

    if (isBlocked(p)) return bounce('blocked route');

    var id = reelId(p);
    if (id && config.blockReels) {
      var cameFromReel = prev !== null && (reelId(prev) || isReelsPath(prev));
      if (allowedReel === null || !cameFromReel) {
        allowedReel = id;            // first reel opened from somewhere else: allow it
      } else if (id !== allowedReel) {
        return bounce('next reel');  // swiped on to another reel
      }
      return;
    }

    allowedReel = null;
    save('sessionStorage', KEY.safePath, p);
  }

  // Messages-only mode: the first page of a visit is the inbox, not the feed.
  if (config.messagesOnly && !load('sessionStorage', KEY.launched, false) && env.path() === '/') {
    save('sessionStorage', KEY.launched, true);
    lastPath = '/';
    env.navigate('/direct/inbox/');
  }
  save('sessionStorage', KEY.launched, true);

  function wrapHistory(name) {
    var original = history[name];
    history[name] = function () {
      var result = original.apply(this, arguments);
      checkRoute();
      return result;
    };
  }
  wrapHistory('pushState');
  wrapHistory('replaceState');
  window.addEventListener('popstate', checkRoute);
  window.addEventListener('hashchange', checkRoute);
  // Fallback in case a navigation slips past the wrappers.
  setInterval(checkRoute, 500);
  checkRoute();

  // Stop clicks on blocked links before Instagram's router sees them.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch (err) { return; }
    if (url.origin !== location.origin) return;
    if (isBlocked(url.pathname)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      log('click blocked', url.pathname);
    }
  }, true);

  // ------------------------------------------------------------ page cleanup

  function hide(el, why) {
    if (!el || el.hasAttribute(HIDDEN_ATTR)) return;
    el.setAttribute(HIDDEN_ATTR, why);
    log('hid', why, el);
  }

  function labelSet(list) {
    var set = {};
    (list || []).forEach(function (l) { set[l.toLowerCase()] = true; });
    return set;
  }
  var suggestedLabels = labelSet(RULES.suggestedLabels);
  var bannerLabels = labelSet(RULES.appBannerLabels);
  var reelPostSelector = (RULES.reelPostSelectors || []).join(', ');
  var storySelector = (RULES.storyLinkSelectors || []).join(', ');

  function ownText(el) { return (el.textContent || '').trim().toLowerCase(); }

  // For a label outside an <article>, climb to the block that sits directly in
  // the feed list (the ancestor whose parent also holds posts).
  function feedBlockFor(el) {
    var article = el.closest('article');
    if (article) return article;
    var node = el;
    for (var i = 0; i < 12 && node.parentElement; i++) {
      var parent = node.parentElement;
      if (parent === document.body || parent.tagName === 'MAIN') return null;
      if (parent.querySelector(':scope > * article, :scope > article')) return node;
      node = parent;
    }
    return null;
  }

  function cleanFeed(root) {
    if (config.hideReelPostsInFeed && reelPostSelector) {
      root.querySelectorAll('article:not([' + HIDDEN_ATTR + '])').forEach(function (a) {
        if (a.querySelector(reelPostSelector)) hide(a, 'reel-post');
      });
    }
    if (config.hideSuggested) {
      root.querySelectorAll('span, div, h2, h3, h4').forEach(function (el) {
        if (el.children.length > 0 || !suggestedLabels[ownText(el)]) return;
        var block = feedBlockFor(el);
        if (block) hide(block, 'suggested');
      });
    }
  }

  // The Stories tray: the smallest element holding all the story links.
  function cleanStories(root) {
    if (!storySelector) return;
    var links = root.querySelectorAll(storySelector);
    if (!links.length) return;
    var tray = links[0].parentElement;
    for (var i = 1; i < links.length && tray; i++) {
      while (tray && !tray.contains(links[i])) tray = tray.parentElement;
    }
    if (tray && tray !== document.body && tray.tagName !== 'MAIN' && !tray.querySelector('article')) hide(tray, 'stories');
  }

  function fixedAncestor(el, levels) {
    for (var node = el, i = 0; node && node !== document.body && i < levels; node = node.parentElement, i++) {
      var pos = getComputedStyle(node).position;
      if (pos === 'fixed' || pos === 'sticky') return node;
    }
    return null;
  }

  // "Use the app" banners and pop-ups.
  function cleanBanners(root) {
    root.querySelectorAll('a, button, [role="button"]').forEach(function (el) {
      if (el.hasAttribute(HIDDEN_ATTR) || !bannerLabels[ownText(el)]) return;
      var dialog = el.closest('[role="dialog"]');
      if (dialog && (dialog.textContent || '').length < 400) {
        hide(fixedAncestor(dialog, 8) || dialog, 'app-dialog');
        if (document.body.style.overflow === 'hidden') document.body.style.overflow = '';
        return;
      }
      hide(fixedAncestor(el, 6) || el, 'app-banner');
    });
  }

  function cleanPage() {
    var root = document.body;
    if (!root) return;
    var onHome = env.path() === '/';
    if (onHome) cleanFeed(root);
    if (onHome && config.hideStories) cleanStories(root);
    if (config.hideAppBanners) cleanBanners(root);
  }

  var pending = false;
  function scheduleClean() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      cleanPage();
    });
  }

  function setFlag(name, on) {
    if (on) document.documentElement.setAttribute(name, '');
    else document.documentElement.removeAttribute(name);
  }

  function start() {
    setFlag('data-reels-blocker-explore', config.hideExplore);
    setFlag('data-reels-blocker-banners', config.hideAppBanners);
    new MutationObserver(scheduleClean).observe(document.documentElement, { childList: true, subtree: true });
    scheduleClean();
  }

  // At document start <html> may not exist yet.
  if (document.documentElement) start();
  else {
    var waitRoot = new MutationObserver(function () {
      if (!document.documentElement) return;
      waitRoot.disconnect();
      start();
    });
    waitRoot.observe(document, { childList: true });
  }

  // Used by the settings panel, the tests and later the iOS app.
  window.__reelsBlocker = {
    settings: SETTINGS,
    get config() { return config; },
    pending: function () { return load('localStorage', KEY.pending, {}); },
    requestChange: requestChange,
    cancelPending: cancelPending,
    applyDue: applyDue,
    reload: function () { env.reload(); },
    // Re-applies the current settings without a page load (used by the demo).
    refresh: function () {
      lastPath = null;
      document.querySelectorAll('[' + HIDDEN_ATTR + ']').forEach(function (n) { n.removeAttribute(HIDDEN_ATTR); });
      setFlag('data-reels-blocker-explore', config.hideExplore);
      setFlag('data-reels-blocker-banners', config.hideAppBanners);
      checkRoute();
      cleanPage();
    },
    checkRoute: checkRoute,
    cleanPage: cleanPage
  };
})();

/*
 * Settings panel for the web version (Stage 5 toggles, Stage 6 friction).
 *
 * A small round button in the corner opens a panel with one switch per
 * setting. Turning a block on is instant. Turning one off starts a countdown
 * (30 seconds by default), and only then takes effect. The page reloads when
 * the panel is closed after a change, so the new settings apply everywhere.
 *
 * The panel lives in a shadow root so Instagram's styles don't reach it.
 * It can also be opened by adding #reels-blocker to the URL.
 */
(function () {
  'use strict';

  var api = window.__reelsBlocker;
  if (!api || window.__reelsBlockerPanel) return;
  window.__reelsBlockerPanel = true;

  var CSS = [
    ':host { all: initial; }',
    '* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }',
    '.fab { position: fixed; right: 12px; bottom: 76px; z-index: 2147483646; width: 36px; height: 36px;',
    '  border-radius: 50%; border: 0; background: rgba(0,0,0,.55); color: #fff; font-size: 18px; line-height: 36px;',
    '  text-align: center; cursor: pointer; opacity: .6; padding: 0; }',
    '.fab:hover { opacity: 1; }',
    '.scrim { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,.4);',
    '  display: flex; align-items: flex-end; justify-content: center; }',
    '.panel { width: 100%; max-width: 420px; max-height: 90vh; overflow: auto; background: #fff; color: #111;',
    '  border-radius: 16px 16px 0 0; padding: 18px 18px 22px; }',
    '@media (min-width: 600px) { .scrim { align-items: center; } .panel { border-radius: 16px; } }',
    'h2 { font-size: 17px; margin: 0 0 4px; }',
    '.sub { font-size: 13px; color: #666; margin: 0 0 12px; }',
    '.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 0;',
    '  border-top: 1px solid #eee; }',
    '.row:first-of-type { border-top: 0; }',
    '.label { font-size: 15px; }',
    '.note, .wait { display: block; font-size: 12px; color: #777; margin-top: 2px; }',
    '.wait { color: #b45309; }',
    '.wait button { border: 0; background: none; color: #2563eb; font-size: 12px; padding: 0 0 0 6px; cursor: pointer; }',
    '.switch { position: relative; width: 46px; height: 28px; flex: none; }',
    '.switch input { opacity: 0; width: 0; height: 0; position: absolute; }',
    '.track { position: absolute; inset: 0; border-radius: 14px; background: #ccc; transition: background .15s; cursor: pointer; }',
    '.track::after { content: ""; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%;',
    '  background: #fff; transition: transform .15s; box-shadow: 0 1px 2px rgba(0,0,0,.3); }',
    'input:checked + .track { background: #16a34a; }',
    'input:checked + .track::after { transform: translateX(18px); }',
    'input:focus-visible + .track { outline: 2px solid #2563eb; outline-offset: 2px; }',
    '.done { width: 100%; margin-top: 14px; padding: 11px; border: 0; border-radius: 10px; background: #111;',
    '  color: #fff; font-size: 15px; cursor: pointer; }',
    '@media (prefers-color-scheme: dark) {',
    '  .panel { background: #1c1c1e; color: #f2f2f2; } .row { border-color: #333; }',
    '  .sub, .note { color: #999; } .wait { color: #f59e0b; } .wait button { color: #60a5fa; }',
    '  .track { background: #555; } .done { background: #f2f2f2; color: #111; }',
    '}'
  ].join('\n');

  var host, root, scrim, ticker;
  var changed = false;

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text) node.textContent = text;
    return node;
  }

  function secondsLeft(at) { return Math.max(0, Math.ceil((at - Date.now()) / 1000)); }

  function render() {
    if (!scrim) return;
    var panel = scrim.querySelector('.panel');
    panel.textContent = '';
    panel.appendChild(el('h2', {}, 'Reels blocker'));
    panel.appendChild(el('p', { class: 'sub' },
      'Turning a block off takes ' + api.config.unlockDelaySeconds + ' seconds.'));

    var pending = api.pending();
    api.settings.forEach(function (s) {
      var row = el('div', { class: 'row' });
      var text = el('div');
      var id = 'rb-' + s.key;
      text.appendChild(el('label', { class: 'label', for: id }, s.label));
      if (s.note) text.appendChild(el('span', { class: 'note' }, s.note));

      var p = pending[s.key];
      var shown = p ? p.value : api.config[s.key];
      if (p) {
        var wait = el('span', { class: 'wait', 'data-wait': s.key },
          'Changes in ' + secondsLeft(p.at) + 's');
        var cancel = el('button', { type: 'button' }, 'Cancel');
        cancel.addEventListener('click', function () { api.cancelPending(s.key); render(); });
        wait.appendChild(cancel);
        text.appendChild(wait);
      }

      var sw = el('label', { class: 'switch' });
      var input = el('input', { type: 'checkbox', id: id, 'data-key': s.key });
      input.checked = !!shown;
      input.addEventListener('change', function () {
        var result = api.requestChange(s.key, input.checked);
        if (result.applied) changed = true;
        render();
      });
      sw.appendChild(input);
      sw.appendChild(el('span', { class: 'track' }));

      row.appendChild(text);
      row.appendChild(sw);
      panel.appendChild(row);
    });

    var done = el('button', { class: 'done', type: 'button' }, 'Done');
    done.addEventListener('click', close);
    panel.appendChild(done);
  }

  function tick() {
    if (api.applyDue()) { changed = true; render(); return; }
    var pending = api.pending();
    root.querySelectorAll('[data-wait]').forEach(function (w) {
      var p = pending[w.getAttribute('data-wait')];
      if (p) w.firstChild.textContent = 'Changes in ' + secondsLeft(p.at) + 's';
    });
  }

  function open() {
    if (scrim) return;
    changed = false;
    scrim = el('div', { class: 'scrim', role: 'dialog', 'aria-label': 'Reels blocker settings' });
    scrim.appendChild(el('div', { class: 'panel' }));
    scrim.addEventListener('click', function (e) { if (e.target === scrim) close(); });
    root.appendChild(scrim);
    render();
    ticker = setInterval(tick, 1000);
  }

  function close() {
    if (!scrim) return;
    clearInterval(ticker);
    scrim.remove();
    scrim = null;
    if (changed) api.reload();
  }

  function mount() {
    if (host || !document.body) return;
    host = el('div', { id: 'reels-blocker-settings' });
    root = host.attachShadow({ mode: 'open' });
    root.appendChild(el('style', {}, CSS));
    var fab = el('button', { class: 'fab', type: 'button', 'aria-label': 'Reels blocker settings', title: 'Reels blocker settings' }, '⊘');
    fab.addEventListener('click', open);
    root.appendChild(fab);
    document.documentElement.appendChild(host);
    if (location.hash === '#reels-blocker') open();
  }

  window.addEventListener('hashchange', function () { if (location.hash === '#reels-blocker') open(); });
  // Changes that finish counting down while the panel is closed still apply.
  setInterval(function () { if (!scrim && api.applyDue()) api.reload(); }, 5000);

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  window.__reelsBlockerPanelApi = { open: open, close: close };
})();
