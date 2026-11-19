import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBridge } from '../testrail-chat/runtime/codex-bridge.mjs';

test('Codex, Gemini and Copilot generation accept the mock task and request plain JSON', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mcp-json-agents-'));
  const saved = { CODEX_BIN: process.env.CODEX_BIN, GEMINI_BIN: process.env.GEMINI_BIN, COPILOT_BIN: process.env.COPILOT_BIN };
  const fixture = path.join(dir, 'cli.mjs');
  await writeFile(fixture, `import { writeFile } from 'node:fs/promises';
let text='';for await(const chunk of process.stdin)text+=chunk;
if(!text.includes('JSON-мок'))process.exit(2);
const content='{"mock":true}';
if(process.argv.includes('--output-last-message'))await writeFile(process.argv[process.argv.indexOf('--output-last-message')+1],content);
else {console.log(JSON.stringify({type:'message',role:'assistant',content}));console.log(JSON.stringify({type:'assistant.message',data:{content}}));}
`);
  for (const name of Object.keys(saved)) process.env[name] = fixture;
  const token = 'test'.repeat(16);
  const server = createBridge({ token });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    for (const route of ['/generate', '/generate/gemini-mcp', '/generate/copilot-mcp']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'mock', systemPrompt: 'JSON', model: '', images: [], task: 'mock' }) });
      assert.equal(response.status, 200, await response.clone().text());
      assert.deepEqual(JSON.parse((await response.json()).text), { mock: true });
    }
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(dir, { recursive: true, force: true });
  }
});
