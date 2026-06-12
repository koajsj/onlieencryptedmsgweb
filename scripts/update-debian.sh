#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  exec sudo -E bash "${SCRIPT_DIR}/deploy-debian.sh" "$@"
fi

exec bash "${SCRIPT_DIR}/deploy-debian.sh" "$@"
