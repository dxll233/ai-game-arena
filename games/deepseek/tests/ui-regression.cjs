'use strict';

/*
 * 第二轮 P0 浏览器回归：toast / hint 的文本与可访问性生命周期。
 *
 * 依赖：dev-only 的 playwright-core（不参与游戏运行）。
 * 安装与运行示例（PowerShell）：
 *   npm install playwright-core --prefix "$env:TEMP\night-game-playwright"
 *   $env:NODE_PATH="$env:TEMP\night-game-playwright\node_modules"
 *   $env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
 *   node tests/ui-regression.cjs
 *
 * 本测试用 #debug 快速触发一次真实点灯事件，只用于制造 toast；
 * 不修改游戏成绩、不跳关、不注入无敌。正式试玩不使用 #debug。
 */

const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const URL = pathToFileURL(path.join(ROOT, 'index.html')).href + '#debug';
const CHROME = process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const results = [];
function record(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} :: ${detail}`);
}

async function axTexts(context, page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Accessibility.enable');
  const tree = await cdp.send('Accessibility.getFullAXTree');
  return tree.nodes
    .filter((n) => !n.ignored)
    .map((n) => ({
      role: n.role && n.role.value,
      name: n.name && n.name.value
    }))
    .filter((n) => n.name);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required']
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'zh-CN' });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(URL);
  await page.waitForTimeout(500);
  await page.click('#startBtn');
  await page.waitForTimeout(250);
  await page.click('#introStartBtn');
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const state = window.__NIGHT_DEBUG__.getState();
    window.__NIGHT_DEBUG__.teleport(state.braziers[0].x + 20, state.braziers[0].y);
    state.player.oil = 100;
  });
  await page.waitForTimeout(100);
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(1900);
  await page.keyboard.up('KeyE');
  await page.waitForTimeout(250);

  const currentToast = await page.evaluate(() => {
    const el = document.getElementById('toast');
    return {
      text: el.textContent,
      role: el.getAttribute('role'),
      ariaHidden: el.getAttribute('aria-hidden'),
      className: el.className
    };
  });
  record('P0-1a', '当前 toast 是状态消息', currentToast.role === 'status' &&
    currentToast.text.length > 0 && currentToast.ariaHidden === 'false' &&
    currentToast.className.indexOf('is-visible') !== -1,
    JSON.stringify(currentToast));

  const axCurrent = await axTexts(context, page);
  record('P0-1b', '当前 toast 文本存在于可访问树', axCurrent.some((n) => n.name === currentToast.text),
    `status=${axCurrent.filter((n) => n.role === 'status').length}, text=${currentToast.text}`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const pauseToast = await page.evaluate(() => {
    const el = document.getElementById('toast');
    return { text: el.textContent, ariaHidden: el.getAttribute('aria-hidden') };
  });
  record('P0-2', '暂停即清空旧 toast', pauseToast.text === '' && pauseToast.ariaHidden === 'true',
    JSON.stringify(pauseToast));

  await page.click('#restartBtn');
  await page.waitForTimeout(450);
  const afterRestart = await page.evaluate(() => {
    const toast = document.getElementById('toast');
    const hint = document.getElementById('hintText');
    return {
      toastText: toast.textContent,
      toastAriaHidden: toast.getAttribute('aria-hidden'),
      toastClass: toast.className,
      hintText: hint.textContent,
      screen: window.__NIGHT_DEBUG__.getScreen(),
      lit: window.__NIGHT_DEBUG__.getState().braziersLit
    };
  });
  record('P0-3', '重开后旧 toast 文本和可访问状态均被清空',
    afterRestart.toastText === '' && afterRestart.toastAriaHidden === 'true' &&
    afterRestart.toastClass.indexOf('is-visible') === -1 &&
    afterRestart.hintText.indexOf('北岭') === -1 && afterRestart.lit === 0,
    JSON.stringify(afterRestart));

  const axAfter = await axTexts(context, page);
  record('P0-4', '重开后可访问树不含上一局 toast',
    !axAfter.some((n) => n.name.indexOf('北岭灯') !== -1 || n.name.indexOf('已点亮') !== -1),
    JSON.stringify(axAfter.filter((n) => n.role === 'status')));

  // 连续重开 10 次：toast 不得复活，且当前局提示仍可正常产生。
  await page.evaluate(() => {
    const state = window.__NIGHT_DEBUG__.getState();
    window.__NIGHT_DEBUG__.teleport(state.braziers[1].x + 20, state.braziers[1].y);
    state.player.oil = 100;
  });
  await page.waitForTimeout(100);
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(1900);
  await page.keyboard.up('KeyE');
  await page.waitForTimeout(200);
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(60);
    await page.click('#restartBtn');
    await page.waitForTimeout(100);
  }
  const afterMany = await page.evaluate(() => {
    const toast = document.getElementById('toast');
    return {
      text: toast.textContent,
      ariaHidden: toast.getAttribute('aria-hidden'),
      lit: window.__NIGHT_DEBUG__.getState().braziersLit,
      screen: window.__NIGHT_DEBUG__.getScreen()
    };
  });
  record('P0-5', '连续重开 10 次无旧 toast 复活', afterMany.text === '' &&
    afterMany.ariaHidden === 'true' && afterMany.lit === 0 && afterMany.screen === 'playing',
    JSON.stringify(afterMany));

  record('P0-6', '无控制台/页面异常', consoleErrors.length === 0 && pageErrors.length === 0,
    JSON.stringify({ consoleErrors, pageErrors }));

  // 失焦自动暂停 + 失焦时已按住的移动键不得在恢复后继续生效
  const beforeBlurX = await page.evaluate(() => window.__NIGHT_DEBUG__.getState().player.x);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(120);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(350);
  const pausedByBlur = await page.evaluate(() => window.__NIGHT_DEBUG__.getScreen());
  await page.keyboard.up('KeyD');
  await page.click('#resumeBtn');
  await page.waitForTimeout(250);
  const afterResumeX = await page.evaluate(() => window.__NIGHT_DEBUG__.getState().player.x);
  await page.waitForTimeout(450);
  const laterX = await page.evaluate(() => window.__NIGHT_DEBUG__.getState().player.x);
  record('P0-7', '失焦暂停并清空持按键', pausedByBlur === 'paused' &&
    afterResumeX > beforeBlurX && Math.abs(laterX - afterResumeX) < 1.5,
    JSON.stringify({ beforeBlurX, pausedByBlur, afterResumeX, laterX }));

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`SUMMARY ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
