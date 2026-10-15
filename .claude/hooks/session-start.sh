#!/bin/bash
# Installs REA (reverse-engineering MCP server + skill) and Ghidra for Claude Code cloud sessions.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

GHIDRA_SERIES="12.1"   # REA requires a Ghidra 12.1.x release
GHIDRA_ROOT="/opt/ghidra"

# --- Ghidra -----------------------------------------------------------------
ghidra_dir="$(ls -d "$GHIDRA_ROOT"/ghidra_${GHIDRA_SERIES}*_PUBLIC 2>/dev/null | sort -V | tail -n1 || true)"

if [ -z "$ghidra_dir" ]; then
  echo "Installing Ghidra ${GHIDRA_SERIES}.x..." >&2
  url="$(curl -fsSL --retry 3 "https://api.github.com/repos/NationalSecurityAgency/ghidra/releases?per_page=30" 2>/dev/null \
    | python3 -c "
import json, sys
for r in json.load(sys.stdin):
    if r['tag_name'].startswith('Ghidra_${GHIDRA_SERIES}') and not r['prerelease']:
        for a in r['assets']:
            if a['name'].endswith('.zip'):
                print(a['browser_download_url']); sys.exit()
" 2>/dev/null || true)"

  if [ -n "$url" ]; then
    tmp="$(mktemp -d)"
    if curl -fsSL --retry 3 -o "$tmp/ghidra.zip" "$url"; then
      mkdir -p "$GHIDRA_ROOT"
      unzip -q "$tmp/ghidra.zip" -d "$GHIDRA_ROOT"
      ghidra_dir="$(ls -d "$GHIDRA_ROOT"/ghidra_${GHIDRA_SERIES}*_PUBLIC | sort -V | tail -n1)"
    fi
    rm -rf "$tmp"
  fi

  if [ -z "$ghidra_dir" ]; then
    echo "WARNING: could not download Ghidra (is github.com allowed by the environment's network policy?). REA will run without Ghidra." >&2
  fi
fi

if [ -n "$ghidra_dir" ]; then
  export GHIDRA_INSTALL_DIR="$ghidra_dir"
  echo "export GHIDRA_INSTALL_DIR=\"$ghidra_dir\"" >> "$CLAUDE_ENV_FILE"
fi

# --- REA --------------------------------------------------------------------
# Registers the REA MCP server in ~/.claude.json and installs the REA skill.
# Run with GHIDRA_INSTALL_DIR exported so the registration picks it up.
npx -y rea-agents setup --client claude_code --yes > /dev/null
