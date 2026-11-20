import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCodex, checkSourcePaths, extractSourcePaths, sourceWorkingDirectory, codexGenerationArgs } from '../testrail-chat/runtime/codex-bridge.mjs';

test('requirements paths are checked on the server before starting generation', async () => {
  const missing = '/home/testrail-source-fixture-not-present/project';
  await assert.rejects(checkSourcePaths(`Прочитай ${missing}`), /Разрешить чтение исходников/);
  await assert.rejects(runCodex({ prompt: `Прочитай ${missing}`, systemPrompt: '', images: [], allowSourceRead: true }), /Исходники недоступны.*ENOENT/);
  assert.deepEqual(await checkSourcePaths('Страница /my-account/requests, ручка /bff/claims/list'), []);
  assert.deepEqual(await checkSourcePaths('Документация https://host/home/example'), []);
});

test('Codex starts in the checked project directory, keeps read-only sandbox and reports source failures', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'testrail-source-'));
  const saved = process.env.CODEX_BIN;
  try {
    const source = path.join(dir, 'handler.json');
    await writeFile(source, JSON.stringify({ method: 'POST', route: '/bff/claims/list' }));
    const fixture = path.join(dir, 'cli.mjs');
    await writeFile(fixture, `import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
let prompt = ''; for await (const chunk of process.stdin) prompt += chunk;
if (prompt.includes('NO_SOURCE')) {
  assert(prompt.includes('Не используй инструменты'));
  assert(process.argv.includes('shell_tool'));
  assert(process.argv.includes('unified_exec'));
  await writeFile(process.argv[process.argv.indexOf('--output-last-message') + 1], '{"cases":[{"title":"From requirements"}]}');
  process.exit(0);
}
assert(!process.argv.includes('shell_tool'));
assert(!prompt.includes('Не используй инструменты'));
assert(prompt.includes('сначала найди и прочитай реализацию'));
const args = process.argv;
assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
const source = prompt.match(/SOURCE=(\\S+)/)[1];
assert.equal(process.cwd(), path.dirname(source));
assert.equal(args[args.indexOf('--cd') + 1], path.dirname(source));
assert(prompt.includes('всегда используй абсолютные пути'));
const data = JSON.parse(await readFile(source, 'utf8'));
await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify(data));
`);
    process.env.CODEX_BIN = fixture;
    assert.equal(JSON.parse(await runCodex({ prompt: 'NO_SOURCE', systemPrompt: 'UI', images: [] })).cases[0].title, 'From requirements');
    const request = { prompt: `Прочитай SOURCE=${source}\nФайл ${source}`, systemPrompt: 'UI', model: '', images: [], allowSourceRead: true };
    assert.deepEqual(JSON.parse(await runCodex(request)), { method: 'POST', route: '/bff/claims/list' });
    await writeFile(source, JSON.stringify({ error: 'valid mock response' }));
    assert.deepEqual(JSON.parse(await runCodex({ ...request, task: 'mock' })), { error: 'valid mock response' });
    await writeFile(source, JSON.stringify({ testrailSourceError: 'Не удалось прочитать связанные исходники' }));
    await assert.rejects(runCodex(request), /Не удалось прочитать связанные исходники/);
  } finally {
    if (saved === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = saved;
    await rm(dir, { recursive: true, force: true });
  }
});


test('Windows drive paths, quoted spaces and UNC paths require explicit permission and native validation', async () => {
  const windows = String.raw`D:\Shared\ui\ui`;
  assert.deepEqual(extractSourcePaths('Проект D://Shared/ui/ui, страница /my-account/requests'), [windows]);
  assert.deepEqual(extractSourcePaths(String.raw`Проект "D:\Shared folder\ui" и 'D:/other folder/ui'`), [String.raw`D:\Shared folder\ui`, String.raw`D:\other folder\ui`]);
  assert.deepEqual(extractSourcePaths(String.raw`Проект \\server\share\ui`), [String.raw`\\server\share\ui`]);
  assert.deepEqual(extractSourcePaths('Документация https://host/home/project'), []);
  await assert.rejects(checkSourcePaths('Проект D:/Shared/ui/ui'), /Разрешить чтение исходников/);
  await assert.rejects(checkSourcePaths('Проект D:/Shared/ui/ui', true, { platform: 'linux' }), /Путь Windows.*сервер/);
  const checked = [];
  const statFile = async file => { checked.push(file); return { isDirectory: () => true }; };
  const accessFile = async file => { checked.push(file); };
  assert.deepEqual(await checkSourcePaths('Проект D://Shared/ui/ui', true, { platform: 'win32', statFile, accessFile }), [windows]);
  assert.deepEqual(checked, [windows, windows]);
  assert.equal(await sourceWorkingDirectory([windows], { platform: 'win32', statFile }), windows);
  assert.equal(await sourceWorkingDirectory([windows + String.raw`\page.ts`], { platform: 'win32', statFile: async () => ({ isDirectory: () => false }) }), windows);
  await assert.rejects(checkSourcePaths('Проект D:/missing', true, { platform: 'win32', statFile: async () => { throw Object.assign(Error('missing'), { code: 'ENOENT' }); }, accessFile }), /Исходники недоступны.*ENOENT/);
});

test('isolated Windows generation explicitly selects a read-only native sandbox', () => {
  const args = codexGenerationArgs(true, 'win32');
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(args[args.indexOf('--ask-for-approval') + 1], 'never');
  assert.ok(args.includes('windows.sandbox="elevated"'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(!args.includes('--add-dir'));
  assert.ok(!args.includes('shell_tool'));
  assert.ok(!codexGenerationArgs(true, 'linux').includes('--config'));
  const disabled = codexGenerationArgs(false, 'win32');
  assert.ok(disabled.includes('shell_tool'));
  assert.ok(disabled.includes('unified_exec'));
  assert.ok(!disabled.includes('--config'));
});


test('CLI cancellation preserves AbortError and a missing executable reports the actual cause', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'testrail-source-abort-'));
  const saved = process.env.CODEX_BIN;
  try {
    const fixture = path.join(dir, 'cli.mjs');
    await writeFile(fixture, 'process.stdin.resume(); setInterval(() => {}, 1000);');
    process.env.CODEX_BIN = fixture;
    await assert.rejects(runCodex({ prompt: 'NO_SOURCE', systemPrompt: '', images: [] },
      AbortSignal.timeout(200)), error => error.name === 'AbortError');
    process.env.CODEX_BIN = path.join(dir, 'missing-codex.exe');
    await assert.rejects(runCodex({ prompt: 'NO_SOURCE', systemPrompt: '', images: [] }), /Codex CLI не найден/);
  } finally {
    if (saved === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = saved;
    await rm(dir, { recursive: true, force: true });
  }
});
