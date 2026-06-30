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
APP_HOST="${APP_HOST:-127.0.0.1}"
APP_PORT="${APP_PORT:-3000}"
DOMAIN="${DOMAIN:-257823.xyz}"
WWW_DOMAIN="${WWW_DOMAIN:-}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-qwer@1234}"
ADMIN_UPDATE_PASSPHRASE="${ADMIN_UPDATE_PASSPHRASE:-admin}"
SAFE_RESET_PATHS=(
  "public/index.html"
  "public/admin.html"
  "public/admin-user.html"
  "public/app.min.js"
  "public/admin.min.js"
  "public/admin-user.min.js"
  "public/styles.min.css"
  "public/admin.min.css"
  "public/admin-user.min.css"
  "public/build-manifest.json"
)

hash_password() {
  local password="$1"
  node -e "const crypto=require('node:crypto');const password=process.argv[1];const salt=crypto.randomBytes(16).toString('hex');const hash=crypto.scryptSync(password,salt,64).toString('hex');process.stdout.write('scrypt:'+salt+':'+hash);" "$password"
}

read_env_value() {
  local key="$1"
  if [ ! -f "${ENV_FILE}" ]; then
    return 1
  fi
  grep -E "^${key}=" "${ENV_FILE}" | tail -n 1 | cut -d '=' -f 2-
}

ensure_line() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" "${ENV_FILE}" 2>/dev/null; then
    sed -i "s|^${key}=.*$|${key}=${value}|" "${ENV_FILE}"
  else
    printf '%s=%s\n' "${key}" "${value}" >> "${ENV_FILE}"
  fi
}

ensure_line_if_missing() {
  local key="$1"
  local value="$2"
  if ! grep -qE "^${key}=" "${ENV_FILE}" 2>/dev/null; then
    printf '%s=%s\n' "${key}" "${value}" >> "${ENV_FILE}"
  fi
}

remove_line() {
  local key="$1"
  if [ -f "${ENV_FILE}" ]; then
    sed -i "/^${key}=/d" "${ENV_FILE}"
  fi
}

ensure_domains() {
  if [ -n "${DOMAIN}" ] && [ -z "${WWW_DOMAIN}" ]; then
    WWW_DOMAIN="www.${DOMAIN}"
  fi
  if [ -z "${DOMAIN}" ] || [ -z "${WWW_DOMAIN}" ]; then
    echo "DOMAIN and WWW_DOMAIN are required for the default Caddy/443 deployment." >&2
    exit 1
  fi
}

normalize_environment_file() {
  if [ ! -f "${ENV_FILE}" ]; then
    return
  fi
  ensure_line "HOST" "${APP_HOST}"
  ensure_line "PORT" "${APP_PORT}"
  ensure_line "NODE_ENV" "production"
  ensure_line "COOKIE_SECURE" "1"
  ensure_line "TRUST_PROXY" "1"
  ensure_line "TRUSTED_ORIGINS" "https://${DOMAIN},https://${WWW_DOMAIN}"
  ensure_line "HSTS_MAX_AGE_SECONDS" "31536000"
  ensure_line "ADMIN_USERNAME" "${ADMIN_USERNAME}"
  ensure_line "ADMIN_PASSWORD_HASH" "$(hash_password "${ADMIN_PASSWORD}")"
  ensure_line "ADMIN_UPDATE_PASSPHRASE" "${ADMIN_UPDATE_PASSPHRASE}"
  remove_line "ADMIN_PASSWORD"
  ensure_line_if_missing "TRUSTED_PROXY_ADDRESSES" "127.0.0.1,::1,::ffff:127.0.0.1"
  ensure_line_if_missing "ALLOW_BEARER_AUTH" "0"
  ensure_line_if_missing "ACCESS_LOG_RETENTION_DAYS" "30"
  ensure_line_if_missing "ACCESS_LOG_MAX_QUEUE" "10000"
  ensure_line_if_missing "ENABLE_IP_GEO" "1"
  ensure_line_if_missing "IP_GEO_TIMEOUT_MS" "1500"
  ensure_line_if_missing "IP_GEO_CACHE_TTL_MS" "86400000"
  remove_line "MANAGE_CADDY"

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

assert_caddy_available() {
  if ! command -v caddy >/dev/null 2>&1; then
    echo "Caddy is required for the default 443 deployment, but it is not installed." >&2
    echo "Run scripts/deploy-debian.sh or install Caddy before running this update." >&2
    exit 1
  fi
}

assert_public_ports_available_for_caddy() {
  if ! command -v ss >/dev/null 2>&1; then
    return
  fi
  local listeners=""
  listeners="$(ss -lntp 2>/dev/null | awk '$4 ~ /:80$/ || $4 ~ /:443$/ { print }' | grep -v caddy || true)"
  if [ -n "${listeners}" ]; then
    echo "Port 80/443 is already used by a non-Caddy process:" >&2
    echo "${listeners}" >&2
    echo "Stop that service first, then rerun the update script." >&2
    exit 1
  fi
}

write_caddy_config() {
  install -d -m 0755 "$(dirname "${CADDYFILE}")"
  cat > "${CADDYFILE}" <<EOF
${DOMAIN}, ${WWW_DOMAIN} {
    encode zstd gzip
    reverse_proxy ${APP_HOST}:${APP_PORT}
}
EOF
}

restart_caddy() {
  assert_caddy_available
  write_caddy_config
  caddy validate --config "${CADDYFILE}"
  systemctl enable caddy
  assert_public_ports_available_for_caddy
  if systemctl is-active --quiet caddy; then
    systemctl reload caddy || systemctl restart caddy
  else
    systemctl restart caddy
  fi
  if ! systemctl is-active --quiet caddy; then
    echo "caddy failed to start. Recent logs:" >&2
    journalctl -u caddy -n 60 --no-pager >&2 || true
    exit 1
  fi
}

main() {
  ensure_domains
  normalize_environment_file
  update_repository
  build_application
  restart_application
  restart_caddy
  echo "Update complete."
}

main "$@"
