import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codexCommand } from './runtime/codex-bridge.mjs';
import { agentCommand } from './runtime/local-agents.mjs';

const providers = {
  codex: { label: 'Codex CLI', packageName: '@openai/codex', command: codexCommand },
  gemini: { label: 'Gemini CLI', packageName: '@google/gemini-cli', command: () => agentCommand('gemini-mcp') },
  copilot: { label: 'Copilot CLI', packageName: '@github/copilot', command: () => agentCommand('copilot-mcp') },
};

function npmCommand() {
  if (process.platform !== 'win32') return ['npm', []];
  const directories = [path.dirname(process.execPath), ...(process.env.PATH || '').split(path.delimiter)];
  for (const directory of directories.filter(Boolean)) {
    const entry = path.join(directory.replace(/^"|"$/g, ''), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (existsSync(entry)) return [process.execPath, [entry]];
  }
  throw Error('npm не найден. Установите Node.js вместе с npm.');
}

function versionWorks(command) {
  const [binary, prefix] = command();
  return spawnSync(binary, [...prefix, '--version'], { stdio: 'ignore', windowsHide: true, timeout: 15000 }).status === 0;
}

async function downloadPackage(name, info, directory, npm, index) {
  const url = new URL(info.dist?.tarball);
  if (url.origin !== 'https://registry.npmjs.org' || !/^sha512-[A-Za-z0-9+/=]+$/.test(info.dist?.integrity || '')) {
    throw Error(`Не удалось проверить метаданные npm-пакета ${name}.`);
  }
  const archive = path.join(directory, `package-${index}.tgz`);
  console.log(`Скачивание ${name} ${info.version}…`);
  execFileSync(process.platform === 'win32' ? 'curl.exe' : 'curl', [
    '--fail', '--location', '--progress-bar', '--proto', '=https', '--proto-redir', '=https',
    '--connect-timeout', '20', '--max-time', '900', '--output', archive, url.href
  ], { stdio: 'inherit', windowsHide: true });
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  if (`sha512-${hash.digest('base64')}` !== info.dist.integrity) {
    throw Error(`Контрольная сумма пакета ${name} не совпала.`);
  }
  npm(['cache', 'add', archive]);
  return archive;
}

export async function ensureCli(provider) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw Error('Требуется Node.js 22.12 или новее.');
  const { label, packageName, command } = Object.hasOwn(providers, provider) ? providers[provider] : {};
  if (!command) throw Error('Укажите codex, gemini или copilot.');
  if (versionWorks(command)) {
    console.log(`${label} уже установлен.`);
    return;
  }
  const [binary, prefix] = npmCommand();
  const registry = '--registry=https://registry.npmjs.org';
  const npm = (args, capture = false) => execFileSync(binary, [...prefix, ...args, registry], {
    encoding: 'utf8', windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit'
  });
  const metadata = specification => JSON.parse(npm(['view', specification, 'dist', 'version', 'optionalDependencies', '--json'], true));
  const info = metadata(`${packageName}@latest`);
  const directory = await mkdtemp(path.join(tmpdir(), 'testrail-cli-'));
  try {
    const archive = await downloadPackage(packageName, info, directory, npm, 0);
    const musl = provider === 'copilot' && process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime;
    const platform = musl ? 'linuxmusl' : process.platform;
    const nativeName = `${packageName}-${platform}-${process.arch}`;
    const nativeVersion = info.optionalDependencies?.[nativeName];
    if (nativeVersion) {
      const specification = nativeVersion.startsWith('npm:') ? nativeVersion.slice(4) : `${nativeName}@${nativeVersion}`;
      await downloadPackage(nativeName, metadata(specification), directory, npm, 1);
    }
    console.log(`Распаковка и установка ${label}. npm может скачать дополнительные зависимости…`);
    npm(['install', '--global', '--prefer-offline', '--no-audit', '--no-fund', archive]);
    const npmPrefix = npm(['prefix', '--global'], true).trim();
    const binDirectory = process.platform === 'win32' ? npmPrefix : path.join(npmPrefix, 'bin');
    process.env.PATH = [binDirectory, process.env.PATH].filter(Boolean).join(path.delimiter);
    if (!versionWorks(command)) throw Error(`${label} не запускается после установки. Проверьте PATH.`);
    console.log(`${label} установлен. Если приложение уже открыто, перезапустите его.`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await ensureCli(process.argv[2] || (await readFile(new URL('./provider.txt', import.meta.url), 'utf8')).trim());
  } catch (error) {
    process.exitCode = 1;
    console.error(error.stderr?.trim?.() || error.message);
  }
}
