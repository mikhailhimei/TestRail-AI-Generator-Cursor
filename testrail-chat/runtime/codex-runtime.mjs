import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import path from 'node:path';

export function bridgeStateRoot(env = process.env, platform = process.platform) {
  if (env.CODEX_BRIDGE_DIR) return path.resolve(env.CODEX_BRIDGE_DIR);
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'), 'TestRail-AI-Generator');
  if (platform === 'darwin') return path.join(homedir(), 'Library', 'Application Support', 'TestRail-AI-Generator');
  return path.join(env.XDG_STATE_HOME || path.join(homedir(), '.local', 'state'), 'testrail-ai-generator');
}

export async function ensureBridgeToken(root, legacyRoots = [], configuredToken = process.env.CODEX_BRIDGE_TOKEN) {
  if (configuredToken) {
    if (configuredToken.length < 32) throw Error('CODEX_BRIDGE_TOKEN должен содержать минимум 32 символа');
    return configuredToken;
  }
  const directory = path.join(root, '.codex-bridge');
  const filename = path.join(directory, 'token');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const saved = (await readFile(filename, 'utf8')).trim();
      if (saved.length >= 32) return saved;
      // Another adapter may have just created the file and still be writing it.
      if (attempt === 9) throw Error('Некорректный локальный токен сервера');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      let token;
      for (const legacyRoot of legacyRoots) {
        try {
          const legacy = (await readFile(path.join(legacyRoot, '.codex-bridge', 'token'), 'utf8')).trim();
          if (legacy.length >= 32) { token = legacy; break; }
        } catch (legacyError) { if (legacyError.code !== 'ENOENT') throw legacyError; }
      }
      token ||= randomBytes(32).toString('hex');
      try { await writeFile(filename, token, { mode: 0o600, flag: 'wx' }); return token; }
      catch (writeError) { if (writeError.code !== 'EEXIST') throw writeError; }
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error('Не удалось прочитать токен локального сервера');
}

export function pairingDialogCommand(origin, platform = process.platform) {
  if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) throw Error('Недопустимый источник подключения');
  const text = `Расширение ${origin} запрашивает подключение к TestRail AI Generator.\n\nЕсли вы только что нажали «Подключить чат» или «Подключить Codex» в расширении, разрешите подключение. Иначе откажитесь.`;
  if (platform === 'win32') {
    const script = `Add-Type -AssemblyName System.Windows.Forms; $answer = [System.Windows.Forms.MessageBox]::Show('${text.replace(/'/g, "''")}', 'TestRail AI Generator', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question, [System.Windows.Forms.MessageBoxDefaultButton]::Button2); if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) { exit 0 } else { exit 1 }`;
    return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]];
  }
  if (platform === 'darwin') return ['osascript', ['-e', `display dialog ${JSON.stringify(text)} with title "TestRail AI Generator" buttons {"Cancel", "Connect"} default button "Cancel" cancel button "Cancel"`]];
  return ['zenity', ['--question', '--default-cancel', '--title=TestRail AI Generator', `--text=${text}`, '--ok-label=Подключить', '--cancel-label=Отмена']];
}

export async function confirmDesktopPair(origin) {
  const [command, args] = pairingDialogCommand(origin);
  return new Promise(resolve => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: 'ignore', signal: AbortSignal.timeout(60000) });
    child.once('error', () => resolve(false));
    child.once('close', code => resolve(code === 0));
  });
}
