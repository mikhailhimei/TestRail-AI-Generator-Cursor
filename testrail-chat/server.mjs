import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBridgeClient } from './bridge-client.mjs';

const client = createBridgeClient({ pluginDirectory: path.dirname(fileURLToPath(import.meta.url)) });
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let active = 0;
let ended = false;
// Start at MCP connection time, even before the first tool call.
void client.ensureServer().catch(error => { process.stderr.write(`[TestRail] ${error.message}\n`); });
input.once('close', () => { ended = true; if (!active) void client.close(); });
function output(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
input.on('line', async line => {
  active++;
  let message;
  try {
    if (line.length > 12 * 1024 * 1024) throw Error('Request too large');
    message = JSON.parse(line);
    const response = await client.call(message);
    if (response !== null) output(response);
  } catch (error) {
    if (message?.id !== undefined) output({ jsonrpc: '2.0', id: message.id, error: {
      code: -32603, message: error instanceof Error ? error.message : 'Ошибка встроенного сервера TestRail'
    } });
    else if (!message) output({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  } finally {
    active--;
    if (ended && !active) void client.close();
  }
});
