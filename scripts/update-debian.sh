#!/usr/bin/env bash

set -euo pipefail

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "This script must be run as root. Re-run with sudo or as root." >&2
  exit 1
fi

APP_NAME="${APP_NAME:-secure-chat}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
APP_BRANCH="${APP_BRANCH:-main}"
ENV_FILE="${ENV_FILE:-/etc/default/${APP_NAME}}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-qwer@1234}"
SAFE_RESET_PATHS=(
  "public/app.min.js"
  "public/admin.min.js"
  "public/styles.min.css"
  "public/admin.min.css"
  "public/build-manifest.json"
)

ensure_line() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" "${ENV_FILE}" 2>/dev/null; then
    sed -i "s|^${key}=.*$|${key}=${value}|" "${ENV_FILE}"
  else
    printf '%s=%s\n' "${key}" "${value}" >> "${ENV_FILE}"
  fi
}

remove_line() {
  local key="$1"
  if [ -f "${ENV_FILE}" ]; then
    sed -i "/^${key}=/d" "${ENV_FILE}"
  fi
}

normalize_environment_file() {
  if [ ! -f "${ENV_FILE}" ]; then
    return
  fi
  ensure_line "ADMIN_USERNAME" "${ADMIN_USERNAME}"
  ensure_line "ADMIN_PASSWORD" "${ADMIN_PASSWORD}"
  remove_line "ADMIN_PASSWORD_HASH"
  chmod 0600 "${ENV_FILE}" 2>/dev/null || true
}

reset_safe_generated_files() {
  local path=""
  for path in "${SAFE_RESET_PATHS[@]}"; do
    if git -C "${APP_DIR}" ls-files --error-unmatch "${path}" >/dev/null 2>&1; then
      git -C "${APP_DIR}" restore --source=HEAD --worktree --staged -- "${path}" 2>/dev/null || \
        git -C "${APP_DIR}" restore --source=HEAD --worktree -- "${path}" 2>/dev/null || true
    fi
  done
}

assert_clean_worktree_for_pull() {
  local remaining_changes=""
  remaining_changes="$(git -C "${APP_DIR}" status --porcelain)"
  if [ -n "${remaining_changes}" ]; then
    echo "Refusing to update because the repository still has local changes:" >&2
    echo "${remaining_changes}" >&2
    echo "Commit, stash, or remove those changes before rerunning the update script." >&2
    exit 1
  fi
}

update_repository() {
  git config --global --add safe.directory "${APP_DIR}" 2>/dev/null || true
  reset_safe_generated_files
  assert_clean_worktree_for_pull
  git -C "${APP_DIR}" fetch origin "${APP_BRANCH}"
  git -C "${APP_DIR}" checkout "${APP_BRANCH}"
  git -C "${APP_DIR}" pull --ff-only origin "${APP_BRANCH}"
}

build_application() {
  cd "${APP_DIR}"
  npm ci --include=dev
  npm run build
}

restart_application() {
  systemctl restart "${APP_NAME}"
  if ! systemctl is-active --quiet "${APP_NAME}"; then
    echo "${APP_NAME} failed to restart. Recent logs:" >&2
    journalctl -u "${APP_NAME}" -n 60 --no-pager >&2 || true
    exit 1
  fi
}

reload_caddy_if_present() {
  if ! command -v caddy >/dev/null 2>&1 || [ ! -f /etc/caddy/Caddyfile ]; then
    return
  fi
  caddy validate --config /etc/caddy/Caddyfile
  systemctl reload caddy || systemctl restart caddy
}

main() {
  normalize_environment_file
  update_repository
  build_application
  restart_application
  reload_caddy_if_present
  echo "Update complete."
}

main "$@"
