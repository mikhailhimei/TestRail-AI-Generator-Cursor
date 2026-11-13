import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const source = path.dirname(fileURLToPath(import.meta.url));
const runtime = await import(pathToFileURL(path.join(source, 'runtime', 'codex-runtime.mjs')).href);
const manifest = JSON.parse(await readFile(path.join(source, 'plugin.json'), 'utf8'));
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) throw Error('Требуется Node.js 22.12 или новее');
// State is outside the plugin cache and survives plugin updates.
const root = runtime.bridgeStateRoot();
const legacyState = process.argv.includes('--legacy-state') ? process.argv[process.argv.indexOf('--legacy-state') + 1] : path.dirname(source);
await runtime.ensureBridgeToken(root, [legacyState]);
const marketplace = path.join(root, 'plugin-marketplace');
const destination = path.join(marketplace, 'plugins', manifest.name);
await mkdir(destination, { recursive: true });
if (path.resolve(source) !== path.resolve(destination)) await cp(source, destination, { recursive: true });
const catalogDirectory = path.join(marketplace, '.agents', 'plugins');
await mkdir(catalogDirectory, { recursive: true });
await writeFile(path.join(catalogDirectory, 'marketplace.json'), JSON.stringify({
  name: 'testrail-local', interface: { displayName: 'TestRail AI Generator' },
  plugins: [{ name: manifest.name, source: { source: 'local', path: `./plugins/${manifest.name}` },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }]
}, null, 2));
let cli = process.env.CODEX_INSTALL_CLI || 'codex';
if (!process.env.CODEX_INSTALL_CLI && process.platform === 'win32') {
  const portable = path.join(destination, 'runtime', 'codex', 'codex-x86_64-pc-windows-msvc.exe');
  try { await access(portable); cli = portable; } catch {}
}
execFileSync(cli, ['plugin', 'marketplace', 'add', marketplace], { stdio: 'inherit', windowsHide: true });
execFileSync(cli, ['plugin', 'add', `${manifest.name}@testrail-local`], { stdio: 'inherit', windowsHide: true });
console.log('TestRail AI Generator установлен. Переподключите MCP / откройте новую беседу и выберите плагин.');
console.log('Сервер включён в плагин и запускается автоматически. Отдельно запускать Start Windows.cmd не требуется.');
