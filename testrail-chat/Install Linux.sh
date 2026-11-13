#!/bin/sh
script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
exec sh "$script_directory/install-unix.sh" "$@"
