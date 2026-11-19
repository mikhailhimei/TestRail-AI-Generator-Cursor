import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { downloadPackage } from '../testrail-chat/install-cli.mjs';

const bytes = Buffer.from('verified-package-contents-for-fixture');
const info = { version: '0.170.0-fixture', dist: { tarball: 'https://registry.npmjs.org/@openai/codex/-/fixture.tgz',
  integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') } };
const fileFrom = args => args[args.indexOf('--output') + 1];

test('Windows timeout resumes, verifies SHA-512, then reuses verified archive without another download', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cli-download-test-'));
  try {
    let calls = 0;
    const cached = [];
    const npm = args => cached.push(args);
    const options = { platform: 'win32', log() {}, run(binary, args) {
      calls++; assert.equal(binary, 'curl.exe');
      assert.equal(args[args.indexOf('--max-time') + 1], '3600');
      assert.equal(args[args.indexOf('--continue-at') + 1], '-');
      const file = fileFrom(args);
      if (calls === 1) { writeFileSync(file, bytes.subarray(0, 10)); throw Object.assign(Error('timeout'), { status: 28 }); }
      assert.deepEqual(readFileSync(file), bytes.subarray(0, 10));
      writeFileSync(file, bytes.subarray(10), { flag: 'a' });
    } };
    const archive = await downloadPackage('@openai/codex', info, dir, npm, options);
    assert.deepEqual(await readFile(archive), bytes); assert.equal(calls, 2);
    await downloadPackage('@openai/codex', info, dir, npm, { ...options, run() { assert.fail('downloaded cached archive'); } });
    assert.equal(cached.length, 2); assert.deepEqual(cached[0], ['cache', 'add', archive]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('failed installer retains partial bytes for a later invocation; corrupt downloads are never cached', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cli-download-test-'));
  try {
    let cached = 0;
    const npm = () => cached++;
    const options = { attempts: 1, log() {}, run(_, args) {
      writeFileSync(fileFrom(args), bytes.subarray(0, 8)); throw Object.assign(Error('timeout'), { status: 28 });
    } };
    await assert.rejects(downloadPackage('fixture', info, dir, npm, options), /сохранена/);
    assert.equal(cached, 0);
    await downloadPackage('fixture', info, dir, npm, { log() {}, run(_, args) {
      assert.deepEqual(readFileSync(fileFrom(args)), bytes.subarray(0, 8));
      writeFileSync(fileFrom(args), bytes.subarray(8), { flag: 'a' });
    } });
    assert.equal(cached, 1);
    const other = { ...info, dist: { ...info.dist, tarball: info.dist.tarball + '?other=1' } };
    let bad;
    await assert.rejects(downloadPackage('fixture', other, dir, npm, { log() {}, run(_, args) {
      bad = fileFrom(args); writeFileSync(bad, 'corrupt');
    } }), /Контрольная сумма/);
    assert.equal(cached, 1); assert.equal(existsSync(bad), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('unsupported range restarts safely; untrusted metadata never reaches curl or npm', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cli-download-test-'));
  try {
    for (const status of [33, 22]) {
    let calls = 0;
    const variant = { ...info, dist: { ...info.dist, tarball: info.dist.tarball + '?range=' + status } };
    await downloadPackage('fixture', variant, dir, () => {}, { log() {}, run(_, args) {
      calls++; const file = fileFrom(args);
      if (calls === 1) { writeFileSync(file, 'old'); throw Object.assign(Error('range unsupported'), { status, stdout: status === 22 ? '416' : '' }); }
      assert.equal(existsSync(file), false); writeFileSync(file, bytes);
    } });
    assert.equal(calls, 2);
    }
    await assert.rejects(downloadPackage('fixture', { ...info, dist: { ...info.dist, tarball: 'https://untrusted.example/a.tgz' } }, dir, () => assert.fail(), { run() { assert.fail(); } }), /метаданные/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
