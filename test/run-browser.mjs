import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const candidates = [
    process.env.ARIBB62_CHROME,
    '/run/current-system/sw/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
].filter(Boolean);
const chrome = candidates.find((candidate) => existsSync(candidate));
assert.ok(chrome, 'Chrome not found; set ARIBB62_CHROME');

const profile = mkdtempSync(resolve(tmpdir(), 'aribb62-chrome-'));
try {
    const testUrl = pathToFileURL(resolve('test/browser.test.html')).href;
    const result = spawnSync(chrome, [
        '--headless',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-background-networking',
        '--disable-component-update',
        '--allow-file-access-from-files',
        '--user-data-dir=' + profile,
        '--virtual-time-budget=3000',
        '--dump-dom',
        testUrl
    ], {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 5000, killSignal: 'SIGKILL'});
    const marker = result.stdout.match(/<pre id="result">([^<]*)<\/pre>/);
    assert.equal(marker && marker[1], 'PASS', marker ? marker[1] : (result.stderr || result.stdout));
    console.log('browser rendering and animation: ok');
} finally {
    rmSync(profile, {recursive: true, force: true});
}
