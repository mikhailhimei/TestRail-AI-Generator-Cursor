#!/bin/sh
script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
status=0
sh "$script_directory/install-unix.sh" "$@" || status=$?
if [ -t 0 ]; then
  printf '\nНажмите Enter, чтобы закрыть окно… '
  IFS= read -r answer || :
fi
exit "$status"
