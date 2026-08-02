import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

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
    const args = [
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
    ];
    const result = await new Promise((resolveResult) => {
        const detached = process.platform !== 'win32';
        const child = spawn(chrome, args, {stdio: ['ignore', 'pipe', 'pipe'], detached: detached});
        let stdout = '';
        let stderr = '';
        let settled = false;
        let pendingResult = null;
        let closeFallback = null;
        let timeout = null;
        const complete = (extra) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            clearTimeout(closeFallback);
            resolveResult(Object.assign({stdout: stdout, stderr: stderr}, extra || {}));
        };
        const killChrome = () => {
            if (child.exitCode !== null || child.signalCode !== null) {
                return;
            }
            try {
                if (detached) {
                    process.kill(-child.pid, 'SIGKILL');
                } else {
                    child.kill('SIGKILL');
                }
            } catch (error) {
                child.kill('SIGKILL');
            }
        };
        const finish = (extra) => {
            if (settled || pendingResult) {
                return;
            }
            pendingResult = extra || {};
            clearTimeout(timeout);
            killChrome();
            closeFallback = setTimeout(() => complete(pendingResult), 2000);
        };
        const inspect = () => {
            const marker = stdout.match(/<pre id="result">([^<]*)<\/pre>/);
            if (marker && marker[1] !== 'RUNNING') {
                finish({marker: marker[1]});
            }
        };
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
            inspect();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', (error) => finish({error: error}));
        child.on('close', (status, signal) => {
            complete(Object.assign({}, pendingResult || {}, {status: status, signal: signal}));
        });
        timeout = setTimeout(() => finish({error: new Error('Chrome browser test timed out after 30s')}), 30000);
    });
    assert.equal(
        result.marker,
        'PASS',
        result.marker || [result.error, result.status, result.signal, result.stderr, result.stdout].filter(Boolean).join('\n')
    );
    console.log('browser rendering and animation: ok');
} finally {
    rmSync(profile, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
}
