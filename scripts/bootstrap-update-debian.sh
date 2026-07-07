#!/usr/bin/env bash

set -euo pipefail

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "This script must be run as root. Re-run with sudo or as root." >&2
  exit 1
fi

APP_NAME="${APP_NAME:-secure-chat}"
APP_DIR="${APP_DIR:-/var/www/onlieencryptedmsgweb}"
APP_BRANCH="${APP_BRANCH:-main}"
REPO_URL="${REPO_URL:-https://github.com/koajsj/onlieencryptedmsgweb.git}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/${APP_NAME}-bootstrap}"

create_backup_dir() {
  install -d -m 0700 "${BACKUP_ROOT}"
  mktemp -d "${BACKUP_ROOT}/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX"
}

install_required_packages() {
  if command -v git >/dev/null 2>&1 && dpkg -s ca-certificates >/dev/null 2>&1; then
    return
  fi
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y git ca-certificates
}

prepare_repository() {
  local backup_dir="$1"
  install -d -m 0755 "$(dirname "${APP_DIR}")"
  if [ ! -d "${APP_DIR}/.git" ]; then
    if [ -e "${APP_DIR}" ]; then
      install -d -m 0700 "${backup_dir}"
      mv "${APP_DIR}" "${backup_dir}/previous-app-dir"
    fi
    git clone --branch "${APP_BRANCH}" "${REPO_URL}" "${APP_DIR}"
    return
  fi
  git -C "${APP_DIR}" remote set-url origin "${REPO_URL}"
}

backup_local_state() {
  local backup_dir="$1"
  install -d -m 0700 "${backup_dir}"
  git -C "${APP_DIR}" status --porcelain=v1 > "${backup_dir}/status.txt" 2>/dev/null || true
  git -C "${APP_DIR}" diff > "${backup_dir}/local-changes.patch" 2>/dev/null || true
  git -C "${APP_DIR}" diff --cached > "${backup_dir}/staged-changes.patch" 2>/dev/null || true
  git -C "${APP_DIR}" ls-files --others --exclude-standard -z > "${backup_dir}/untracked-files.zlist" 2>/dev/null || true
  if [ -s "${backup_dir}/untracked-files.zlist" ]; then
    tar --null -C "${APP_DIR}" -czf "${backup_dir}/untracked-files.tgz" --files-from="${backup_dir}/untracked-files.zlist" 2>/dev/null || true
  fi
}

refresh_tracked_files() {
  git config --global --add safe.directory "${APP_DIR}" 2>/dev/null || true
  git -C "${APP_DIR}" fetch origin "${APP_BRANCH}"
  git -C "${APP_DIR}" reset --hard "origin/${APP_BRANCH}"
  git -C "${APP_DIR}" checkout -B "${APP_BRANCH}" "origin/${APP_BRANCH}"
  chmod +x "${APP_DIR}/scripts/update-debian.sh" "${APP_DIR}/scripts/deploy-debian.sh" 2>/dev/null || true
}

main() {
  local backup_dir=""
  backup_dir="$(create_backup_dir)"
  install_required_packages
  prepare_repository "${backup_dir}"

  local previous_rev=""
  previous_rev="$(git -C "${APP_DIR}" rev-parse HEAD 2>/dev/null || true)"
  backup_local_state "${backup_dir}"
  refresh_tracked_files

  APP_NAME="${APP_NAME}" \
    APP_DIR="${APP_DIR}" \
    APP_BRANCH="${APP_BRANCH}" \
    REPO_URL="${REPO_URL}" \
    PREVIOUS_REV="${previous_rev}" \
    SKIP_REPOSITORY_UPDATE=1 \
    bash "${APP_DIR}/scripts/update-debian.sh"
  echo "Bootstrap update complete. Local backup: ${backup_dir}"
}

main "$@"
