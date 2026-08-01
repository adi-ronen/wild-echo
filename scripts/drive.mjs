#!/usr/bin/env node
// Drive the real pages in a real browser, with a fake microphone.
//
// This is not a unit test and it is not in CI. CI here is dependency-free on
// purpose; this needs Playwright and a Chrome, so it runs locally and by hand:
//
//   npm install playwright        # once, outside this repo if you prefer
//   node scripts/drive.mjs                       # main page, all three calls
//   node scripts/drive.mjs --tester              # tester page, config as shipped
//   node scripts/drive.mjs --tester --approved   # tester page, forced approved
//
// --approved never edits tester/config.json. It intercepts the request for that
// file and answers with consentApproved:true, so the recording path can be
// driven whatever the interlock says in the repository. Since 2026-08-01 the
// shipped flag is true, so --approved is a no-op on main; it stays because the
// interlock can go back to false and this must still be drivable when it does.
//
// A fake microphone WAV is needed for the recording paths. Point at one with
// FAKE_MIC=/path/to/48k.wav; anything 48 kHz mono will do, including a copy of
// a reference clip resampled to 48 kHz.
//
// It lives here because it has now caught two bugs that the unit tests could
// not — a double-tap opening two microphone streams, and a shape description
// that called a rise-hold-fall howl "falling". A tool that keeps catching
// things does not belong in /tmp.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, resolve, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8811);
const FAKE_MIC = process.env.FAKE_MIC || '/tmp/fakemic48.wav';
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wav': 'audio/wav',
};

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. `npm install playwright`, then run this again.');
  console.error('It is deliberately not a dependency of this repository: CI stays dependency-free.');
  process.exit(2);
}

const testerMode = process.argv.includes('--tester');
const approved = process.argv.includes('--approved');

if (!existsSync(FAKE_MIC)) {
  console.warn(`No fake microphone at ${FAKE_MIC}. Recording steps will be skipped.`);
}

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  try {
    const body = await readFile(resolve(ROOT, '.' + normalize(p)));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({
  channel: 'chrome',
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${FAKE_MIC}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const ctx = await browser.newContext({ permissions: ['microphone'] });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

const canRecord = existsSync(FAKE_MIC);

if (!testerMode) await driveMainPage();
else await driveTesterPage();

console.log('\nconsole errors:', errors.length ? errors : 'none');
await browser.close();
server.close();

// ------------------------------------------------------------- the main page

async function driveMainPage() {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => document.getElementById('ref-shape').textContent !== '…', null, { timeout: 15000 });

  const options = await page.$$eval('#call option', (os) => os.map((o) => o.value));
  console.log(`call picker: ${options.length} calls`);

  for (const id of options) {
    await page.selectOption('#call', id);
    await page.waitForTimeout(600);
    console.log(`\n${id}`);
    console.log('  shape :', await page.textContent('#ref-shape'));
    console.log('  credit:', await page.textContent('#ref-credit'));
  }

  if (!canRecord) return;

  await page.click('#record');
  await page.waitForTimeout(2500);
  await page.click('#record');
  await page.waitForFunction(() => !document.getElementById('export').disabled, null, { timeout: 20000 });
  console.log('\nafter a take:');
  console.log('  you-shape       :', await page.textContent('#you-shape'));
  console.log('  compare enabled :', !(await page.isDisabled('#compare')));

  // Switching the call must throw the take away. A contour compared against a
  // different call is not evidence about this one.
  await page.selectOption('#call', options[0]);
  await page.waitForTimeout(800);
  console.log('after switching call:');
  console.log('  you-shape       :', await page.textContent('#you-shape'));
  console.log('  compare disabled:', await page.isDisabled('#compare'));
  console.log('  export disabled :', await page.isDisabled('#export'));
}

// ----------------------------------------------------------- the tester page

async function driveTesterPage() {
  if (approved) {
    const cfg = JSON.parse(await readFile(resolve(ROOT, 'tester/config.json'), 'utf8'));
    cfg.consentApproved = true;
    await page.route('**/tester/config.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cfg) }));
  }

  await page.goto(`http://localhost:${PORT}/tester/?t=T04`);
  await page.waitForTimeout(500);
  console.log('blocked screen visible :', await page.isVisible('#screen-blocked'));
  console.log('tester code from link  :', await page.inputValue('#tester-code'));
  console.log('start disabled         :', await page.isDisabled('#start'));

  if (!approved || !canRecord) return;

  await page.check('#agree-read');
  await page.check('#agree-age');
  console.log('start enabled after both:', !(await page.isDisabled('#start')));
  await page.click('#start');
  await page.waitForSelector('#screen-session:not([hidden])');

  // Three calls, one take each. The loop is the point: what this catches is
  // state left over from the previous call — a stale take, a stale reference, a
  // tick box that carried across.
  for (let i = 1; i <= 3; i++) {
    await page.waitForFunction(() => document.getElementById('ref-shape').textContent !== '…', null, { timeout: 20000 });
    console.log(`\n-- ${await page.textContent('#step-title')}`);
    // Printed whole, not truncated: one call carries an extra sentence that
    // exists only because it has to be read, so the driver has to show it.
    console.log('  note                 :', await page.textContent('#call-note'));
    console.log('  extra sentence       :', (await page.$('#call-note .call-warning')) ? 'yes' : 'none');
    console.log('  result hidden at open:', await page.isHidden('#result'));
    console.log('  record disabled first:', await page.isDisabled('#record'));

    await page.click('#play-ref');
    await page.waitForFunction(() => !document.getElementById('record').disabled, null, { timeout: 20000 });
    console.log('  call shape           :', await page.textContent('#ref-shape'));
    console.log('  button label         :', await page.textContent('#record'));

    await page.click('#record');
    await page.waitForTimeout(2500);
    await page.click('#record');
    await page.waitForSelector('#result:not([hidden])', { timeout: 20000 });
    console.log('  your shape           :', await page.textContent('#you-shape'));

    // A second click must not open a second take. This is the bug it caught.
    await page.click('#record', { force: true }).catch(() => {});

    // Tick a box on call 2 only, so the file can be checked for notes travelling
    // with the take they belong to instead of pooling across the session.
    if (i === 2) await page.check('#flags input[value="noisy-room"]');
    await page.click('#next');
  }

  await page.waitForSelector('#screen-done:not([hidden])', { timeout: 20000 });
  console.log('\nsession screen hidden  :', await page.isHidden('#screen-session'));

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.click('#finish'),
  ]).then(([d]) => d);
  const json = JSON.parse(await readFile(await download.path(), 'utf8'));
  console.log('download name          :', download.suggestedFilename());
  console.log('schema                 :', json.schema);
  console.log('consentVersion         :', json.consentVersion);
  console.log('takes                  :', json.takes.length);
  for (const t of json.takes) {
    console.log(`  ${t.reference.id}`);
    console.log('    metrics    :', JSON.stringify(t.metrics));
    console.log('    diagnostics:', JSON.stringify({ ...t.diagnostics, voicedRuns: `${t.diagnostics.voicedRuns.length} runs` }));
    console.log('    notes      :', JSON.stringify(t.notes));
  }
  console.log('bytes of json          :', JSON.stringify(json).length);
  const audioLike = JSON.stringify(json).match(/base64|data:audio|blob:/i);
  console.log('anything audio-shaped  :', audioLike ? audioLike[0] : 'none');
}
