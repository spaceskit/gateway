#!/usr/bin/env bash
#
# Spaceskit Gateway Installer
#
# Usage:
#   curl -fsSL https://spaceskit.dev/install.sh | bash
#
# What this script does:
#   1. Checks for (or installs) Bun runtime
#   2. Installs spaceskit-gateway via npm
#   3. Runs the interactive setup wizard
#   4. Optionally installs as a background service
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SPACESKIT_HOME="$HOME/.spaceskit"
MIN_BUN_VERSION="1.2.0"
NPM_PACKAGE="spaceskit-gateway"

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

log_info()  { echo -e "${BLUE}ℹ${NC}  $1"; }
log_ok()    { echo -e "${GREEN}✓${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}⚠${NC}  $1"; }
log_error() { echo -e "${RED}✗${NC}  $1"; }

# ---------------------------------------------------------------------------
# OS detection
# ---------------------------------------------------------------------------

detect_os() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux)  echo "linux" ;;
    *)      echo "unsupported" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64)  echo "x64" ;;
    aarch64) echo "arm64" ;;
    arm64)   echo "arm64" ;;
    *)       echo "unsupported" ;;
  esac
}

# ---------------------------------------------------------------------------
# Bun installation
# ---------------------------------------------------------------------------

check_bun() {
  if command -v bun &> /dev/null; then
    local version
    version=$(bun --version 2>/dev/null || echo "0.0.0")
    log_ok "Bun $version found"
    return 0
  fi
  return 1
}

install_bun() {
  log_info "Installing Bun runtime..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"

  if check_bun; then
    log_ok "Bun installed successfully"
  else
    log_error "Bun installation failed"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Spaceskit installation
# ---------------------------------------------------------------------------

install_spaceskit() {
  log_info "Installing spaceskit-gateway..."

  # Use bun to install the package globally
  bun install -g "$NPM_PACKAGE" 2>/dev/null || {
    # Fallback: install via npm if bun global install fails
    if command -v npm &> /dev/null; then
      npm install -g "$NPM_PACKAGE"
    else
      log_error "Could not install spaceskit-gateway. Please install manually."
      exit 1
    fi
  }

  log_ok "spaceskit-gateway installed"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  echo ""
  echo -e "${BOLD}┌─────────────────────────────────────────┐${NC}"
  echo -e "${BOLD}│       Spaceskit Gateway Installer        │${NC}"
  echo -e "${BOLD}└─────────────────────────────────────────┘${NC}"
  echo ""

  local os
  os=$(detect_os)
  local arch
  arch=$(detect_arch)

  if [ "$os" = "unsupported" ] || [ "$arch" = "unsupported" ]; then
    log_error "Unsupported platform: $(uname -s) $(uname -m)"
    log_error "Spaceskit Gateway supports macOS and Linux on x64/arm64."
    exit 1
  fi

  log_info "Platform: $os/$arch"

  # Step 1: Ensure Bun is installed
  if ! check_bun; then
    read -rp "Bun is required but not installed. Install it now? [Y/n] " answer
    if [ "${answer:-Y}" != "n" ] && [ "${answer:-Y}" != "N" ]; then
      install_bun
    else
      log_error "Bun is required. Install it from https://bun.sh"
      exit 1
    fi
  fi

  # Step 2: Install spaceskit-gateway
  install_spaceskit

  # Step 3: Create home directory
  mkdir -p "$SPACESKIT_HOME/logs"
  log_ok "Created $SPACESKIT_HOME"

  # Step 4: Run setup wizard
  echo ""
  log_info "Running setup wizard..."
  echo ""
  spaceskit-gateway init

  # Step 5: Ask about background service
  echo ""
  read -rp "Install as a background service (starts on login)? [y/N] " svc_answer
  if [ "${svc_answer:-N}" = "y" ] || [ "${svc_answer:-N}" = "Y" ]; then
    spaceskit-gateway service install
    spaceskit-gateway service start
    log_ok "Gateway installed as a background service"
  fi

  echo ""
  echo -e "${GREEN}${BOLD}Installation complete!${NC}"
  echo ""
  echo "  Start the gateway:      spaceskit-gateway start"
  echo "  Pair a device:          spaceskit-gateway pair"
  echo "  Check status:           spaceskit-gateway status"
  echo "  View help:              spaceskit-gateway help"
  echo ""
  echo "  Config:    ~/.spaceskit/gateway.json"
  echo "  Database:  ~/.spaceskit/gateway.db"
  echo "  Logs:      ~/.spaceskit/logs/"
  echo ""
}

main "$@"
