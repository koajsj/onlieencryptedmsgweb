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
WWW_DOMAIN="${WWW_DOMAIN:-www.${DOMAIN}}"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
ENV_FILE="/etc/default/${APP_NAME}"
CADDYFILE="/etc/caddy/Caddyfile"
DATA_DIR="${DATA_DIR:-/var/lib/${APP_NAME}/data}"
NODE_MAJOR="20"
install_base_packages() {
  apt-get update
  apt-get install -y \
    ca-certificates \
    curl \
    debian-archive-keyring \
    debian-keyring \
    gpg \
    git \
    lsb-release \
    apt-transport-https
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
  if [ -d "${APP_DIR}/.git" ]; then
    git -C "${APP_DIR}" fetch origin "${APP_BRANCH}"
    git -C "${APP_DIR}" reset --hard "origin/${APP_BRANCH}"
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

write_environment_file() {
  {
    printf 'HOST=%s\n' "${APP_HOST}"
    printf 'PORT=%s\n' "${APP_PORT}"
    printf 'DATA_DIR=%s\n' "${DATA_DIR}"
    printf 'NODE_ENV=production\n'
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
    reverse_proxy ${APP_HOST}:${APP_PORT}
}
EOF
}

restart_services() {
  caddy validate --config "${CADDYFILE}"
  systemctl enable "${APP_NAME}"
  systemctl restart "${APP_NAME}"
  systemctl enable caddy
  systemctl restart caddy
}

print_summary() {
  echo "Deployment complete."
  echo "Application directory: ${APP_DIR}"
  echo "Data directory: ${DATA_DIR}"
  echo "HTTPS endpoint: https://${DOMAIN}"
  echo "HTTPS endpoint: https://${WWW_DOMAIN}"
  echo "Admin username: admin"
  echo "Admin password: qwer@1234"
}

main() {
  install_base_packages
  install_nodejs
  install_caddy
  prepare_application_dir
  prepare_data_dir
  write_environment_file
  write_systemd_service
  install_dependencies_and_build
  write_caddy_config
  restart_services
  print_summary
}

main
