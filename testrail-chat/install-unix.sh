#!/bin/sh
set -eu

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
fail() { printf '\n%s\n' "$1" >&2; exit 1; }

printf '[1/4] Проверка Node.js…\n'
command -v node >/dev/null 2>&1 || fail 'Установите Node.js 22.12 или новее с https://nodejs.org/ и повторите запуск.'
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)' || fail 'Требуется Node.js 22.12 или новее. Обновите Node.js и повторите запуск.'

printf '[2/4] Проверка подтверждения подключения…\n'
case "$(uname -s)" in
  Darwin) command -v osascript >/dev/null 2>&1 || fail 'Не найден osascript для показа окна подключения macOS.' ;;
  Linux)
    [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] || fail 'Запустите установку в графическом сеансе Linux: для подключения расширения нужно окно подтверждения.'
    command -v zenity >/dev/null 2>&1 || fail 'Установите пакет zenity через менеджер пакетов вашей системы и повторите запуск.'
    ;;
  *) fail 'Этот установщик предназначен для macOS и Linux.' ;;
esac

printf '[3/4] Проверка Codex CLI…\n'
cli=${CODEX_INSTALL_CLI:-codex}
if ! command -v "$cli" >/dev/null 2>&1; then
  [ -z "${CODEX_INSTALL_CLI:-}" ] || fail 'Не найден Codex CLI, указанный в CODEX_INSTALL_CLI.'
  command -v npm >/dev/null 2>&1 || fail 'Не найден npm. Установите Node.js вместе с npm и повторите запуск.'
  printf 'Установка официального Codex CLI через npm…\n'
  npm install -g @openai/codex || fail 'Не удалось установить Codex CLI. Проверьте доступ к сети и права npm. Затем повторите запуск.'
fi
"$cli" --version || fail 'Codex CLI не запускается. Переустановите его командой npm install -g @openai/codex и повторите запуск.'
"$cli" plugin --help >/dev/null 2>&1 || fail 'Эта версия Codex CLI не поддерживает плагины. Обновите её командой npm install -g @openai/codex.'

printf '[4/4] Установка плагина TestRail AI Generator…\n'
CODEX_INSTALL_CLI="$cli" node "$script_directory/install.mjs" "$@" || fail 'Не удалось установить плагин. Причина указана выше.'
printf '\nОткройте новый чат Codex с плагином TestRail AI Generator.\nВ расширении нажмите «Подключить Codex» и подтвердите доступ.\nСервер запускается автоматически, отдельный запуск не требуется.\n'
