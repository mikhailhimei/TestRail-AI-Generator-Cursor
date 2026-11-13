import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const MAX_BODY = 12 * 1024 * 1024;
const TIMEOUT = 300_000;

function codexCommand() {
  const configured = process.env.CODEX_BIN;
  if (configured) return /\.[cm]?js$/i.test(configured)
    ? [process.execPath, [configured]] : [configured, []];
  if (process.platform === 'win32') {
    const portable = path.join(path.dirname(fileURLToPath(import.meta.url)), 'codex', 'codex-x86_64-pc-windows-msvc.exe');
    if (existsSync(portable)) return [portable, []];
    const dirs = (process.env.PATH || '').split(path.delimiter).map(dir => dir.replace(/^"|"$/g, ''));
    for (const dir of dirs) {
      if (!dir) continue;
      const exe = path.join(dir, 'codex.exe');
      if (existsSync(exe)) return [exe, []];
      // npm's .cmd shim cannot be spawned with shell:false. Run its JS entry directly.
      const entry = path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (existsSync(entry)) return [process.execPath, [entry]];
    }
  }
  return ['codex', []];
}

export async function runCodex({ prompt, systemPrompt, model, images }, signal, onModel = () => {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'testrail-codex-'));
  try {
    const output = path.join(dir, 'response.txt');
    const args = ['exec', '--ignore-user-config', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '--color', 'never',
      '--output-last-message', output];
    if (model) args.push('--model', model);
    for (const [i, image] of images.entries()) {
      const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image);
      if (!match) throw new Error('Поддерживаются изображения PNG, JPEG и WebP в формате data URL');
      const filename = path.join(dir, `image-${i}.${match[1]}`);
      await writeFile(filename, Buffer.from(match[2], 'base64'));
      args.push('--image', filename);
    }
    args.push('-');
    await new Promise((resolve, reject) => {
      const [command, prefix] = codexCommand();
      const child = spawn(command, [...prefix, ...args], {
        cwd: dir, shell: false, stdio: ['pipe', 'ignore', 'pipe'], signal
      });
      let diagnostic = '';
      let headerBuffer = '';
      let readingHeader = true;
      let reportedModel = false;
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => {
        diagnostic = (diagnostic + chunk).slice(-8192);
        if (!readingHeader) return;
        headerBuffer += chunk;
        let end;
        while ((end = headerBuffer.indexOf('\n')) !== -1) {
          const line = headerBuffer.slice(0, end).replace(/\r$/, '');
          headerBuffer = headerBuffer.slice(end + 1);
          if (line === 'user') { readingHeader = false; headerBuffer = ''; break; }
          const match = /^model:\s+([a-zA-Z0-9_.:/-]+)\s*$/.exec(line);
          if (match && !reportedModel) {
            reportedModel = true;
            onModel(match[1]);
            console.info(`[Codex] Model: ${match[1]}`);
          }
        }
        headerBuffer = headerBuffer.slice(-8192);
      });
      child.once('error', err => reject(err.code === 'ENOENT'
        ? new Error('Codex CLI не найден. Установите его и выполните codex login.') : err));
      child.stdin.on('error', () => {});
      child.once('close', code => {
        if (code === 0) return resolve();
        const errorLines = diagnostic.split(/\r?\n/).filter(line => /^(?:ERROR|error):/.test(line));
        const detail = (errorLines.length ? [...new Set(errorLines)].join('\n') : diagnostic.trim())
          .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [скрыто]')
          .replace(/\bsk-[a-zA-Z0-9_-]+/g, '[ключ скрыт]');
        reject(new Error(`Codex CLI завершился с кодом ${code}.${detail
          ? `\n${detail}` : ' CLI не сообщил причину. Проверьте вход и доступ к выбранной модели.'}`));
      });
      child.stdin.end(`Сформируй тест-кейсы. Верни только JSON с массивом cases. Не используй инструменты и не изменяй файлы.\n\nИНСТРУКЦИЯ:\n${systemPrompt}\n\nЗАДАЧА:\n${prompt}`);
    });
    const text = await readFile(output, 'utf8');
    if (!text.trim()) throw new Error('Codex вернул пустой ответ');
    return text;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

function validPayload(data) {
  return data && typeof data.prompt === 'string' && typeof data.systemPrompt === 'string' &&
    (data.prompt.trim() || data.images?.length) && data.prompt.length <= 200_000 &&
    data.systemPrompt.length <= 200_000 && typeof data.model === 'string' && data.model.length <= 200 &&
    Array.isArray(data.images) && data.images.length <= 2 && data.images.every(image =>
      typeof image === 'string' && /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(image));
}

export function createBridge({ token, generate = runCodex, timeoutMs = TIMEOUT, confirmPair = async () => false }) {
  if (!token || token.length < 32) throw new Error('Токен сервера должен содержать минимум 32 символа');
  let busy = false;
  let pairing = false;
  let activeModel = null;
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const reply = (status, body) => {
      if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
    };
    if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return reply(403, { error: 'Источник запрещён' });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'POST' && req.url === '/pair') {
      if (!origin) return reply(403, { error: 'Подключение доступно только из расширения Chrome' });
      if (pairing) return reply(409, { error: 'Подтвердите подключение в окне сервера' });
      pairing = true;
      try {
        if (!await confirmPair(origin)) return reply(403, { error: 'Подключение не подтверждено в окне сервера' });
        return reply(200, { token });
      } catch {
        return reply(408, { error: 'Время подтверждения истекло. Нажмите «Подключить Codex» ещё раз.' });
      } finally { pairing = false; }
    }
    const auth = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return reply(401, { error: 'Неверный токен локального сервера' });
    if (req.method === 'GET' && req.url === '/health') return reply(200, { status: 'ok', busy, model: activeModel });
    if (req.method !== 'POST' || req.url !== '/generate') return reply(404, { error: 'Маршрут не найден' });
    if (!req.headers['content-type']?.startsWith('application/json')) return reply(415, { error: 'Ожидается application/json' });
    if (busy) return reply(409, { error: 'Codex уже обрабатывает запрос' });
    const controller = new AbortController();
    const disconnect = () => controller.abort();
    res.once('close', disconnect);
    let timer;
    let ownsJob = false;
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) { reply(413, { error: 'Запрос слишком большой' }); return; }
        chunks.push(chunk);
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return reply(400, { error: 'Некорректный JSON' }); }
      if (!validPayload(data)) return reply(400, { error: 'Некорректный запрос генерации' });
      if (busy) return reply(409, { error: 'Codex уже обрабатывает запрос' });
      if (controller.signal.aborted) return;
      busy = true;
      activeModel = null;
      ownsJob = true;
      timer = setTimeout(() => controller.abort(), timeoutMs);
      const text = await generate(data, controller.signal, model => { activeModel = model; });
      reply(200, { text, model: activeModel });
    } catch (err) {
      reply(controller.signal.aborted ? 504 : 502, { error: controller.signal.aborted
        ? 'Генерация отменена или превышено время ожидания'
        : err instanceof Error ? err.message : 'Ошибка Codex' });
    } finally {
      clearTimeout(timer);
      res.removeListener('close', disconnect);
      if (ownsJob) busy = false;
    }
  });
}

async function main() {
  const dir = path.resolve('.codex-bridge');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tokenFile = path.join(dir, 'token');
  let token = process.env.CODEX_BRIDGE_TOKEN;
  if (!token) {
    try { token = (await readFile(tokenFile, 'utf8')).trim(); }
    catch (err) {
      if (err.code !== 'ENOENT') throw err;
      token = randomBytes(32).toString('hex');
      await writeFile(tokenFile, token, { mode: 0o600, flag: 'wx' });
    }
  }
  const port = Number(process.env.CODEX_BRIDGE_PORT || 3210);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Неверный CODEX_BRIDGE_PORT');
  const server = createBridge({ token, confirmPair: async origin => {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await terminal.question(
        `\nРасширение ${origin} запрашивает подключение к Codex.\nЕсли вы нажали «Подключить Codex», введите y и нажмите Enter: `,
        { signal: AbortSignal.timeout(60_000) });
      return ['y', 'yes', 'да'].includes(answer.trim().toLowerCase());
    } finally { terminal.close(); }
  } });
  server.requestTimeout = 30_000;
  server.on('error', err => { console.error(err.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Codex bridge: http://127.0.0.1:${port}`);
    console.log('В настройках расширения нажмите «Подключить Codex» и подтвердите подключение в этом окне.');
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err.message); process.exitCode = 1; });
}
