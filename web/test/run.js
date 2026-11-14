// End-to-end checks of the built files against a mock Instagram.
// The mock is served at https://www.instagram.com by intercepting requests,
// so nothing leaves the machine. Run with: npm test (needs Playwright).
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const dist = f => fs.readFileSync(path.join(__dirname, '../dist', f), 'utf8');
const userscript = dist('reels-blocker.user.js');
const demo = dist('demo.html');
const mock = fs.readFileSync(path.join(__dirname, 'mock-instagram.html'), 'utf8');
const BASE = 'https://www.instagram.com';

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`);
  if (!ok) failures++;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function newContext(browser, hostConfig, body = mock) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body }));
  if (hostConfig) await ctx.addInitScript(c => { window.__REELS_BLOCKER_CONFIG__ = c; }, hostConfig);
  if (body === mock) await ctx.addInitScript(userscript);
  return ctx;
}

(async () => {
  const browser = await chromium.launch();

  // ------------------------------------------------------------ defaults
  {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    const visible = sel => page.locator(sel).isVisible();
    const pathNow = () => new URL(page.url()).pathname;

    await page.goto(BASE + '/');
    await sleep(700);
    check('Reels tab hidden', !(await visible('#nav-reels')), 'reels tab visible');
    check('Home and Messages tabs still visible', (await visible('#nav-home')) && (await visible('#nav-dm')), 'nav broken');
    check('Explore visible by default', await visible('#nav-explore'), 'explore hidden');
    check('Stories visible by default', await visible('#stories'), 'stories hidden');
    check('Normal post visible', await visible('#post-normal'), 'normal post hidden');
    check('Reel post in feed hidden', !(await visible('#post-reel')), 'reel post visible');
    check('Suggested post hidden', !(await visible('#post-suggested')), 'suggested post visible');
    check('Suggested accounts row hidden', !(await visible('#carousel')), 'carousel visible');
    check('Late-loaded normal post visible', await visible('#late-normal'), 'late normal hidden');
    check('Late-loaded reel hidden', !(await visible('#late-reel')), 'late reel visible');
    check('"Use the app" banner hidden', !(await visible('#app-banner')), 'banner visible');
    check('Settings button shown', await page.locator('#reels-blocker-settings').count() === 1, 'no settings host');

    await page.evaluate(() => document.getElementById('nav-reels').click());
    await sleep(300);
    check('Click on Reels link blocked', pathNow() === '/', 'path ' + pathNow());

    await page.evaluate(() => window.go('/direct/inbox/'));
    await sleep(100);
    await page.evaluate(() => window.go('/reels/xyz/'));
    await page.waitForLoadState('load'); await sleep(700);
    check('Going to /reels/ bounces back to the previous page', pathNow() === '/direct/inbox/', 'path ' + pathNow());

    const fresh = await ctx.newPage();
    await fresh.goto(BASE + '/reels/');
    await sleep(1000);
    check('Opening /reels/ in a new tab goes home', new URL(fresh.url()).pathname === '/', fresh.url());
    await fresh.close();

    await page.goto(BASE + '/direct/t/1/');
    await sleep(300);
    await page.click('#dm-reel');
    await sleep(700);
    check('Single reel from a DM plays', pathNow() === '/reel/AAA/' && await visible('#reel-view'), 'path ' + pathNow());
    await page.click('#next-reel');
    await page.waitForLoadState('load'); await sleep(1000);
    check('Next reel is blocked, back to the DM thread', pathNow() === '/direct/t/1/', 'path ' + pathNow());

    await page.goto(BASE + '/reel/CCC/');
    await sleep(700);
    check('Direct link to one reel plays', pathNow() === '/reel/CCC/', 'path ' + pathNow());

    await page.goto(BASE + '/friend/');
    await sleep(300);
    check('Profile Reels tab hidden', !(await visible('#profile-reels-tab')), 'profile reels tab visible');
    await ctx.close();
  }

  // ------------------------------------------------- optional blocks via config
  {
    const ctx = await newContext(browser, { hideExplore: true, hideStories: true });
    const page = await ctx.newPage();
    await page.goto(BASE + '/explore/');
    await sleep(1000);
    check('hideExplore: /explore/ goes home', new URL(page.url()).pathname === '/', page.url());
    check('hideExplore: Explore link hidden', !(await page.locator('#nav-explore').isVisible()), 'explore visible');
    check('hideStories: Stories tray hidden', !(await page.locator('#stories').isVisible()), 'stories visible');
    check('hideStories: feed still visible', await page.locator('#post-normal').isVisible(), 'feed hidden');
    await page.goto(BASE + '/stories/anna/1/');
    await sleep(1000);
    check('hideStories: /stories/ goes home', new URL(page.url()).pathname === '/', page.url());
    await ctx.close();
  }

  // ---------------------------------------------------- messages-only mode
  {
    const ctx = await newContext(browser, { messagesOnly: true });
    const page = await ctx.newPage();
    await page.goto(BASE + '/');
    await sleep(1000);
    check('messagesOnly: opening Instagram lands in the inbox', new URL(page.url()).pathname === '/direct/inbox/', page.url());
    await page.click('#nav-home');
    await sleep(500);
    check('messagesOnly: Home is still reachable after launch', new URL(page.url()).pathname === '/', page.url());
    await ctx.close();
  }

  // ---------------------------------------------- settings panel and friction
  {
    const ctx = await newContext(browser, { unlockDelaySeconds: 2 });
    const page = await ctx.newPage();
    await page.goto(BASE + '/');
    await sleep(700);
    const host = page.locator('#reels-blocker-settings');
    await host.locator('.fab').click();
    check('Settings panel opens', await host.locator('.panel').isVisible(), 'panel not open');
    check('Panel lists all 8 settings', await host.locator('input[type=checkbox]').count() === 8, 'wrong count');

    // Loosening waits.
    await host.locator('input[data-key=hideSuggested] + .track').click();
    await sleep(200);
    check('Turning a block off shows a countdown', await host.locator('[data-wait=hideSuggested]').isVisible(), 'no countdown');
    check('...and does not apply yet', await page.evaluate(() => window.__reelsBlocker.config.hideSuggested) === true, 'applied early');

    // Tightening is instant.
    await host.locator('input[data-key=hideStories] + .track').click();
    await sleep(200);
    check('Turning a block on applies at once', await page.evaluate(() => window.__reelsBlocker.config.hideStories) === true, 'not applied');

    await sleep(2600);
    check('After the wait, the change applies', await page.evaluate(() => window.__reelsBlocker.config.hideSuggested) === false, 'still on');

    await host.locator('.done').click();
    await page.waitForLoadState('load'); await sleep(1000);
    check('After Done and reload: suggested posts show', await page.locator('#post-suggested').isVisible(), 'still hidden');
    check('After Done and reload: Stories hidden', !(await page.locator('#stories').isVisible()), 'stories visible');

    // Cancel stops a pending change.
    await host.locator('.fab').click();
    await host.locator('input[data-key=blockReels] + .track').click();
    await sleep(200);
    await host.locator('[data-wait=blockReels] button').click();
    await sleep(2600);
    check('Cancel keeps the block on', await page.evaluate(() => window.__reelsBlocker.config.blockReels) === true, 'block turned off');
    await ctx.close();
  }

  // ------------------------------------------------------------- demo page
  {
    const ctx = await newContext(browser, null, demo);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('https://demo.example/some/path/index.html');
    await sleep(700);
    check('Demo: Reels tab hidden', !(await page.locator('#nav-reels').isVisible()), 'visible');
    check('Demo: reel post hidden', !(await page.locator('#post-reel').isVisible()), 'visible');
    await page.click('#nav-dm');
    await page.click('#dm-thread');
    await page.fill('#demo-path', '/reels/');
    await page.click('#demo-go button');
    await sleep(800);
    check('Demo: typing /reels/ bounces back', await page.locator('#dm-reel').isVisible(), 'not bounced: ' + page.url());
    await page.click('#dm-reel');
    await sleep(300);
    check('Demo: single reel plays', await page.locator('#reel-view').isVisible(), 'no reel');
    await page.click('#next-reel');
    await sleep(800);
    check('Demo: next reel bounces to the chat', await page.locator('#dm-reel').isVisible(), page.url());
    check('Demo: no page errors', errors.length === 0, errors.join('; '));
    await ctx.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
