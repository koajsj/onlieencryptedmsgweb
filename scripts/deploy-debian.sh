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
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
ENV_FILE="/etc/default/${APP_NAME}"
DATA_DIR="${DATA_DIR:-/var/lib/${APP_NAME}/data}"
NODE_MAJOR="20"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD_HASH=""

read_hidden_value() {
  local prompt="$1"
  local value=""
  while [ -z "${value}" ]; do
    read -r -s -p "${prompt}" value
    echo
  done
  printf '%s' "${value}"
}

install_base_packages() {
  apt-get update
  apt-get install -y \
    ca-certificates \
    curl \
    git \
    gpg
}

install_nodejs() {
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
}

prepare_application_dir() {
  mkdir -p "$(dirname "${APP_DIR}")"
  git config --global --add safe.directory "${APP_DIR}" 2>/dev/null || true
  if [ -d "${APP_DIR}/.git" ]; then
    git -C "${APP_DIR}" fetch origin "${APP_BRANCH}"
    git -C "${APP_DIR}" checkout "${APP_BRANCH}"
    git -C "${APP_DIR}" pull --ff-only origin "${APP_BRANCH}"
  else
    git clone --branch "${APP_BRANCH}" "${REPO_URL}" "${APP_DIR}"
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

ensure_admin_credentials() {
  local existing_username=""
  local existing_hash=""
  existing_username="$(read_env_value "ADMIN_USERNAME" || true)"
  existing_hash="$(read_env_value "ADMIN_PASSWORD_HASH" || true)"

  if [ -n "${existing_username}" ] && [ -n "${existing_hash}" ]; then
    ADMIN_USERNAME="${existing_username}"
    ADMIN_PASSWORD_HASH="${existing_hash}"
    return
  fi

  if ! [[ "${ADMIN_USERNAME}" =~ ^[A-Za-z0-9_]{3,24}$ ]]; then
    echo "ADMIN_USERNAME must match ^[A-Za-z0-9_]{3,24}$" >&2
    exit 1
  fi

  local password=""
  local confirm=""
  while true; do
    password="$(read_hidden_value "Set admin password: ")"
    confirm="$(read_hidden_value "Confirm admin password: ")"
    if [ "${password}" != "${confirm}" ]; then
      echo "Passwords do not match. Please try again." >&2
      continue
    fi
    if [ "${#password}" -lt 4 ] || [ "${#password}" -gt 72 ]; then
      echo "Admin password length must be between 4 and 72 characters." >&2
      continue
    fi
    break
  done

  ADMIN_PASSWORD_HASH="$(
    ADMIN_PASSWORD_INPUT="${password}" node <<'EOF'
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scryptAsync = promisify(crypto.scrypt);

(async () => {
  const password = String(process.env.ADMIN_PASSWORD_INPUT || "");
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 64)).toString("hex");
  process.stdout.write(`scrypt:${salt}:${hash}`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
EOF
  )"
  unset ADMIN_PASSWORD_INPUT
}

write_environment_file() {
  {
    printf 'HOST=%s\n' "${APP_HOST}"
    printf 'PORT=%s\n' "${APP_PORT}"
    printf 'DATA_DIR=%s\n' "${DATA_DIR}"
    printf 'NODE_ENV=production\n'
    printf 'ADMIN_USERNAME=%s\n' "${ADMIN_USERNAME}"
    printf 'ADMIN_PASSWORD_HASH=%s\n' "${ADMIN_PASSWORD_HASH}"
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

restart_services() {
  systemctl enable "${APP_NAME}"
  systemctl restart "${APP_NAME}"
  if ! systemctl is-active --quiet "${APP_NAME}"; then
    echo "${APP_NAME} failed to start. Recent logs:" >&2
    journalctl -u "${APP_NAME}" -n 60 --no-pager >&2 || true
    exit 1
  fi
}

print_summary() {
  echo "Deployment complete."
  echo "Application directory: ${APP_DIR}"
  echo "Data directory: ${DATA_DIR}"
  echo "Application bind: http://${APP_HOST}:${APP_PORT}"
  echo "Admin username: ${ADMIN_USERNAME}"
  echo "Admin password: configured on server and stored only as a hash in ${ENV_FILE}"
}

main() {
  install_base_packages
  install_nodejs
  prepare_application_dir
  prepare_data_dir
  ensure_admin_credentials
  write_environment_file
  write_systemd_service
  install_dependencies_and_build
  restart_services
  print_summary
}

main
