import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function localAgentLabel(agent) {
  return agent === 'gemini-mcp' ? 'Gemini MCP' : agent === 'copilot-mcp' ? 'Copilot MCP' : 'Codex';
}

export function agentCommand(agent) {
  const gemini = agent === 'gemini-mcp';
  const executable = gemini ? 'gemini' : 'copilot';
  const configured = process.env[gemini ? 'GEMINI_BIN' : 'COPILOT_BIN'];
  if (configured) return /\.[cm]?js$/i.test(configured)
    ? [process.execPath, [configured]] : [configured, []];
  if (process.platform === 'win32') {
    for (const directory of (process.env.PATH || '').split(path.delimiter)) {
      if (!directory) continue;
      const dir = directory.replace(/^"|"$/g, '');
      const exe = path.join(dir, executable + '.exe');
      if (existsSync(exe)) return [exe, []];
      const module = gemini ? '@google/gemini-cli/bundle/gemini.js' : '@github/copilot/npm-loader.js';
      const script = path.join(dir, 'node_modules', module);
      if (existsSync(script)) return [process.execPath, [script]];
    }
  }
  return [executable, []];
}

export function redactCliOutput(value) {
  return String(value).replace(/Bearer\s+[^\s"']+/gi, 'Bearer [скрыто]')
    .replace(/\b(?:sk-[a-zA-Z0-9_-]+|gh[pousr]_[a-zA-Z0-9_]+|github_pat_[a-zA-Z0-9_]+|AIza[a-zA-Z0-9_-]{35})\b/g, '[ключ скрыт]');
}

export function runJsonCli({ command, args, cwd, prompt, signal, label, onEvent }) {
  signal.throwIfAborted();
  const [binary, prefix] = command();
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [...prefix, ...args], {
      cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    const stop = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
        killer.once('error', () => child.kill());
        killer.once('close', code => { if (code !== 0) child.kill(); });
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
      }
    };
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    let pending = '';
    let diagnostics = '';
    let failure = '';
    const handleLine = line => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (!event || typeof event !== 'object') return;
      failure = onEvent(event) || failure;
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      pending += chunk;
      let end;
      while ((end = pending.indexOf('\n')) !== -1) {
        handleLine(pending.slice(0, end));
        pending = pending.slice(end + 1);
      }
      pending = pending.slice(-4000000);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4000); });
    child.stdin.on('error', () => {});
    child.once('error', error => {
      signal.removeEventListener('abort', stop);
      reject(error.code === 'ENOENT' ? Error(`${label}: CLI не найден. Установите CLI и выполните вход.`) : error);
    });
    child.once('close', code => {
      signal.removeEventListener('abort', stop);
      if (pending) handleLine(pending);
      if (signal.aborted) reject(signal.reason);
      else if (code === 0 && !failure) resolve();
      else reject(Error(redactCliOutput(failure || `${label} завершился с кодом ${code}. ${diagnostics.trim()}`)));
    });
    child.stdin.end(prompt);
  });
}

export async function runLocalAgent({ agent, cwd, prompt, signal, model, attachments = [], report, onModel = () => {} }) {
  const gemini = agent === 'gemini-mcp';
  const editing = Boolean(report);
  const label = localAgentLabel(agent);
  const args = gemini
    ? ['--output-format', 'stream-json', '--approval-mode', editing ? 'auto_edit' : 'plan']
    : ['--output-format', 'json', '--no-ask-user'];
  if (model) args.push('--model', model);
  if (gemini && !editing) {
    // This directory was created by the bridge and contains only the request attachments.
    args.push('--skip-trust', '--allowed-mcp-server-names', '__testrail_no_mcp__');
    if (attachments.length) prompt = attachments.map(file => '@./' + path.basename(file)).join(' ') + '\n\n' + prompt;
  }
  if (!gemini) {
    if (editing) {
      args.push('--disable-mcp-server', 'github-mcp-server', '--allow-tool=write', '--deny-tool=shell(git commit)', '--deny-tool=shell(git push)');
    } else {
      args.push('--disable-builtin-mcps', '--available-tools=view', '--deny-tool=write', '--deny-tool=shell');
    }
    for (const file of attachments) args.push('--attachment', file);
  }

  let text = '';
  let streamed = '';
  const flush = () => {
    if (streamed.trim()) {
      text = streamed;
      report?.(streamed);
    }
    streamed = '';
  };
  await runJsonCli({ command: () => agentCommand(agent), args, cwd, prompt, signal, label, onEvent(event) {
    const data = event.data || {};
    const actualModel = event.model || data.model || data.selectedModel;
    if (typeof actualModel === 'string') onModel(actualModel);
    if (event.type === 'init' || event.type === 'session.start') report?.(`${label} подключён. Изучение проекта…`);
    if (gemini && event.type === 'message' && event.role === 'assistant' && typeof event.content === 'string') {
      streamed += event.content;
    }
    if (!gemini && event.type === 'assistant.message' && typeof data.content === 'string' && data.content.trim()) {
      text = data.content;
      report?.(text);
    }
    if (event.type === 'tool_use' || event.type === 'tool.execution_start') {
      flush();
      const name = event.tool_name || data.toolName || '';
      const params = event.parameters || data.arguments || {};
      const detail = params.command || params.file_path || params.path || '';
      report?.(`Инструмент: ${name}${typeof detail === 'string' && detail ? ' · ' + detail : ''}`);
    }
    if (event.type === 'tool_result' || event.type === 'tool.execution_complete') {
      if (event.status === 'error' || data.success === false) report?.('Инструмент завершился с ошибкой.');
    }
    if (event.type === 'result' && Array.isArray(event.usage?.codeChanges?.filesModified)) {
      const files = event.usage.codeChanges.filesModified.filter(file => typeof file === 'string');
      if (files.length) report?.(`Изменения файлов: ${files.join(', ')}`);
    }
    if (event.type === 'error' || event.type === 'session.error' ||
        (event.type === 'result' && event.status === 'error')) {
      return event.error?.message || data.message || event.message || `Ошибка ${label}`;
    }
  } });
  flush();
  if (!editing && !text.trim()) throw Error(`${label}: CLI вернул пустой ответ.`);
  return text;
}
