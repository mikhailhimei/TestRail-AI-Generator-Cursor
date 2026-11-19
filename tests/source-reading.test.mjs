import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCodex, checkSourcePaths } from '../testrail-chat/runtime/codex-bridge.mjs';

test('requirements paths are checked on the server before starting generation', async () => {
  const missing = '/home/testrail-source-fixture-not-present/project';
  await assert.rejects(runCodex({ prompt: `Прочитай ${missing}`, systemPrompt: '', images: [] }), /Исходники недоступны.*ENOENT/);
  assert.deepEqual(await checkSourcePaths('Страница /my-account/requests, ручка /bff/claims/list'), []);
  assert.deepEqual(await checkSourcePaths('Документация https://host/home/example'), []);
});

test('Codex can read a project outside its temporary cwd, keeps read-only sandbox and reports source failures', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'testrail-source-'));
  const saved = process.env.CODEX_BIN;
  try {
    const source = path.join(dir, 'handler.json');
    await writeFile(source, JSON.stringify({ method: 'POST', route: '/bff/claims/list' }));
    const fixture = path.join(dir, 'cli.mjs');
    await writeFile(fixture, `import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
let prompt = ''; for await (const chunk of process.stdin) prompt += chunk;
assert(!prompt.includes('Не используй инструменты'));
assert(prompt.includes('сначала найди и прочитай реализацию'));
const args = process.argv;
assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
const source = prompt.match(/SOURCE=(\\S+)/)[1];
assert.notEqual(process.cwd(), source);
const data = JSON.parse(await readFile(source, 'utf8'));
await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify(data));
`);
    process.env.CODEX_BIN = fixture;
    const request = { prompt: `Прочитай SOURCE=${source}\nФайл ${source}`, systemPrompt: 'UI', model: '', images: [] };
    assert.deepEqual(JSON.parse(await runCodex(request)), { method: 'POST', route: '/bff/claims/list' });
    await writeFile(source, JSON.stringify({ error: 'Не удалось прочитать связанные исходники' }));
    await assert.rejects(runCodex(request), /Не удалось прочитать связанные исходники/);
  } finally {
    if (saved === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = saved;
    await rm(dir, { recursive: true, force: true });
  }
});
