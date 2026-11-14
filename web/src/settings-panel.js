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
