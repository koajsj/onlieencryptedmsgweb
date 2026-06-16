#!/usr/bin/env bash

set -euo pipefail

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "This script must be run as root. Re-run with sudo or as root." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
export APT_LISTCHANGES_FRONTEND=none

APP_NAME="secure-chat"
APP_DIR="${APP_DIR:-/var/www/onlieencryptedmsgweb}"
APP_BRANCH="${APP_BRANCH:-main}"
REPO_URL="${REPO_URL:-https://github.com/koajsj/onlieencryptedmsgweb.git}"
APP_HOST="${APP_HOST:-127.0.0.1}"
APP_PORT="${APP_PORT:-3000}"
DOMAIN="${DOMAIN:-257823.xyz}"
WWW_DOMAIN="${WWW_DOMAIN:-www.257823.xyz}"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
ENV_FILE="/etc/default/${APP_NAME}"
CADDYFILE="/etc/caddy/Caddyfile"
DATA_DIR="${DATA_DIR:-/var/lib/${APP_NAME}/data}"
NODE_MAJOR="20"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
ADMIN_PASSWORD_HASH="${ADMIN_PASSWORD_HASH:-}"
ADMIN_UPDATE_PASSPHRASE="${ADMIN_UPDATE_PASSPHRASE:-}"
GENERATED_ADMIN_PASSWORD=""
SAFE_RESET_PATHS=(
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

generate_password() {
  node -e "const crypto=require('node:crypto');process.stdout.write(crypto.randomBytes(18).toString('base64url'));"
}

install_base_packages() {
  apt-get update
  apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    debian-archive-keyring \
    debian-keyring \
    git \
    gpg \
    lsb-release
}

install_nodejs() {
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
}

install_caddy() {
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
}

prepare_application_dir() {
  mkdir -p "$(dirname "${APP_DIR}")"
  git config --global --add safe.directory "${APP_DIR}" 2>/dev/null || true
  if [ -d "${APP_DIR}/.git" ]; then
    reset_safe_generated_files
    assert_clean_worktree_for_pull
    git -C "${APP_DIR}" fetch origin "${APP_BRANCH}"
    git -C "${APP_DIR}" checkout "${APP_BRANCH}"
    git -C "${APP_DIR}" pull --ff-only origin "${APP_BRANCH}"
  else
    git clone --branch "${APP_BRANCH}" "${REPO_URL}" "${APP_DIR}"
  fi
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
    echo "Commit, stash, or remove those changes before rerunning the deploy script." >&2
    exit 1
  fi
}

install_dependencies_and_build() {
  cd "${APP_DIR}"
  npm ci --include=dev
  npm run build
}

prepare_data_dir() {
  mkdir -p "$(dirname "${DATA_DIR}")"
  install -d -o www-data -g www-data -m 0755 "${DATA_DIR}"

  if [ -f "${APP_DIR}/data/admin_audit.jsonl" ] && [ ! -f "${DATA_DIR}/admin_audit.jsonl" ]; then
    cp "${APP_DIR}/data/admin_audit.jsonl" "${DATA_DIR}/admin_audit.jsonl"
  fi
  if [ -f "${APP_DIR}/data/users.json" ] && [ ! -f "${DATA_DIR}/users.json" ]; then
    cp "${APP_DIR}/data/users.json" "${DATA_DIR}/users.json"
  fi
  if [ -f "${APP_DIR}/data/messages.json" ] && [ ! -f "${DATA_DIR}/messages.json" ]; then
    cp "${APP_DIR}/data/messages.json" "${DATA_DIR}/messages.json"
  fi
  if [ -f "${APP_DIR}/data/messages.jsonl" ] && [ ! -f "${DATA_DIR}/messages.jsonl" ]; then
    cp "${APP_DIR}/data/messages.jsonl" "${DATA_DIR}/messages.jsonl"
  fi

  chown -R www-data:www-data "$(dirname "${DATA_DIR}")"
}

read_env_value() {
  local key="$1"
  if [ ! -f "${ENV_FILE}" ]; then
    return 1
  fi
  grep -E "^${key}=" "${ENV_FILE}" | tail -n 1 | cut -d '=' -f 2-
}

ensure_domains() {
  if [ -n "${DOMAIN}" ]; then
    if [ -z "${WWW_DOMAIN}" ]; then
      WWW_DOMAIN="www.${DOMAIN}"
    fi
    return
  fi
}

ensure_admin_credentials() {
  local existing_username=""
  local existing_password=""
  local existing_hash=""
  local existing_update_passphrase=""
  existing_username="$(read_env_value "ADMIN_USERNAME" || true)"
  existing_password="$(read_env_value "ADMIN_PASSWORD" || true)"
  existing_hash="$(read_env_value "ADMIN_PASSWORD_HASH" || true)"
  existing_update_passphrase="$(read_env_value "ADMIN_UPDATE_PASSPHRASE" || true)"

  if [ -n "${existing_username}" ] && [ -n "${existing_password}" ]; then
    ADMIN_USERNAME="${existing_username}"
    ADMIN_PASSWORD_HASH="$(hash_password "${existing_password}")"
  elif [ -n "${existing_username}" ] && [ -n "${existing_hash}" ]; then
    ADMIN_USERNAME="${existing_username}"
    ADMIN_PASSWORD_HASH="${existing_hash}"
  fi

  if ! [[ "${ADMIN_USERNAME}" =~ ^[A-Za-z0-9_]{3,24}$ ]]; then
    echo "ADMIN_USERNAME must match ^[A-Za-z0-9_]{3,24}$" >&2
    exit 1
  fi

  if [ -z "${ADMIN_PASSWORD_HASH}" ]; then
    if [ -n "${ADMIN_PASSWORD}" ]; then
      if [ "${#ADMIN_PASSWORD}" -lt 4 ] || [ "${#ADMIN_PASSWORD}" -gt 72 ]; then
        echo "ADMIN_PASSWORD must be 4-72 characters" >&2
        exit 1
      fi
      ADMIN_PASSWORD_HASH="$(hash_password "${ADMIN_PASSWORD}")"
    else
      GENERATED_ADMIN_PASSWORD="$(generate_password)"
      ADMIN_PASSWORD_HASH="$(hash_password "${GENERATED_ADMIN_PASSWORD}")"
    fi
  fi

  if [ -n "${existing_update_passphrase}" ] && [ -z "${ADMIN_UPDATE_PASSPHRASE}" ]; then
    ADMIN_UPDATE_PASSPHRASE="${existing_update_passphrase}"
  fi
}

write_environment_file() {
  {
    printf 'HOST=%s\n' "${APP_HOST}"
    printf 'PORT=%s\n' "${APP_PORT}"
    printf 'DATA_DIR=%s\n' "${DATA_DIR}"
    printf 'NODE_ENV=production\n'
    printf 'COOKIE_SECURE=1\n'
    printf 'TRUST_PROXY=1\n'
    printf 'HSTS_MAX_AGE_SECONDS=31536000\n'
    printf 'TRUSTED_ORIGINS=%s,%s\n' "https://${DOMAIN}" "https://${WWW_DOMAIN}"
    printf 'ADMIN_USERNAME=%s\n' "${ADMIN_USERNAME}"
    printf 'ADMIN_PASSWORD_HASH=%s\n' "${ADMIN_PASSWORD_HASH}"
    if [ -n "${ADMIN_UPDATE_PASSPHRASE}" ]; then
      printf 'ADMIN_UPDATE_PASSPHRASE=%s\n' "${ADMIN_UPDATE_PASSPHRASE}"
    fi
  } > "${ENV_FILE}"
  chmod 0600 "${ENV_FILE}"
}

write_systemd_service() {
  cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=Secure Chat Server
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node ${APP_DIR}/server.js
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
  chmod 0644 "${SERVICE_FILE}"
  systemctl daemon-reload
}

write_caddy_config() {
  cat > "${CADDYFILE}" <<EOF
${DOMAIN}, ${WWW_DOMAIN} {
    encode zstd gzip
    reverse_proxy ${APP_HOST}:${APP_PORT}
}
EOF
}

restart_services() {
  systemctl enable "${APP_NAME}"
  systemctl restart "${APP_NAME}"
  if ! systemctl is-active --quiet "${APP_NAME}"; then
    echo "${APP_NAME} failed to start. Recent logs:" >&2
    journalctl -u "${APP_NAME}" -n 60 --no-pager >&2 || true
    exit 1
  fi

  caddy validate --config "${CADDYFILE}"
  systemctl enable caddy
  systemctl restart caddy
  if ! systemctl is-active --quiet caddy; then
    echo "caddy failed to start. Recent logs:" >&2
    journalctl -u caddy -n 60 --no-pager >&2 || true
    exit 1
  fi
}

print_summary() {
  echo "Deployment complete."
  echo "Application directory: ${APP_DIR}"
  echo "Data directory: ${DATA_DIR}"
  echo "Public URL: https://${DOMAIN}"
  echo "Public URL: https://${WWW_DOMAIN}"
  echo "Admin username: ${ADMIN_USERNAME}"
  if [ -n "${GENERATED_ADMIN_PASSWORD}" ]; then
    echo "Generated admin password: ${GENERATED_ADMIN_PASSWORD}"
    echo "Store this password now. Only the hash is written to ${ENV_FILE}."
  else
    echo "Admin password: configured and stored as a hash in ${ENV_FILE}"
  fi
}

main() {
  install_base_packages
  install_nodejs
  install_caddy
  ensure_domains
  prepare_application_dir
  prepare_data_dir
  ensure_admin_credentials
  write_environment_file
  write_systemd_service
  install_dependencies_and_build
  write_caddy_config
  restart_services
  print_summary
}

main
