#!/usr/bin/env bash
# Respaldo privado de lo que NO puede ir a este repo (es público):
#   - distribucion/manuales/*.md y distribucion/*.md  (manuales para correo; mencionan correos y puntos débiles)
#   - memoria de Claude Code de este proyecto (~/.claude/projects/<slug>/memory)
#   - .claude/settings.local.json (permisos locales de Claude Code)
# Se guarda en el repo PRIVADO Leonardow33/MAPAS_RC_PRIVADO, clonado junto a este repo (../MAPAS_RC_PRIVADO).
#
# Uso (Git Bash, desde la raíz del repo):
#   bash scripts/respaldo_privado.sh respaldar    # copia lo local al repo privado, hace commit y push
#   bash scripts/respaldo_privado.sh restaurar    # en una laptop nueva: baja el repo privado y copia todo a su lugar
set -euo pipefail

MODO="${1:-}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PRIV_DIR="${PRIV_DIR:-$REPO_DIR/../MAPAS_RC_PRIVADO}"
PRIV_URL="https://github.com/Leonardow33/MAPAS_RC_PRIVADO.git"

# Carpeta de memoria de Claude Code: la ruta del proyecto con todo lo que no sea letra o número cambiado por "-"
# y la letra de la unidad en minúscula (c:\Users\...\MAPAS_RC_AUTO -> c--Users-...-MAPAS-RC-AUTO).
RUTA_WIN="$( (cd "$REPO_DIR" && pwd -W 2>/dev/null) || echo "$REPO_DIR")"
SLUG="$(printf '%s' "$RUTA_WIN" | sed 's/[^A-Za-z0-9]/-/g')"
SLUG="$(printf '%s' "${SLUG:0:1}" | tr 'A-Z' 'a-z')${SLUG:1}"
MEM_DIR="$HOME/.claude/projects/$SLUG/memory"

clonar() {
  if [ ! -d "$PRIV_DIR/.git" ]; then
    echo "Clonando el repo privado en $PRIV_DIR"
    git clone -q "$PRIV_URL" "$PRIV_DIR"
  else
    git -C "$PRIV_DIR" pull -q --rebase || true
  fi
}

case "$MODO" in
  respaldar)
    clonar
    rm -rf "$PRIV_DIR/manuales" "$PRIV_DIR/docs_distribucion" "$PRIV_DIR/claude-memoria" "$PRIV_DIR/claude-settings"
    mkdir -p "$PRIV_DIR/manuales" "$PRIV_DIR/docs_distribucion" "$PRIV_DIR/claude-memoria" "$PRIV_DIR/claude-settings"
    cp "$REPO_DIR"/distribucion/manuales/*.md "$PRIV_DIR/manuales/" 2>/dev/null || echo "  (sin manuales)"
    cp "$REPO_DIR"/distribucion/*.md "$PRIV_DIR/docs_distribucion/" 2>/dev/null || echo "  (sin docs de distribucion)"
    cp "$MEM_DIR"/*.md "$PRIV_DIR/claude-memoria/" 2>/dev/null || echo "  (sin memoria en $MEM_DIR)"
    cp "$REPO_DIR/.claude/settings.local.json" "$PRIV_DIR/claude-settings/" 2>/dev/null || echo "  (sin settings.local.json)"
    cd "$PRIV_DIR"
    git add -A
    if git diff --cached --quiet; then echo "Sin cambios: el respaldo ya estaba al día."; exit 0; fi
    git commit -q -m "chore: respaldo $(date +%Y-%m-%d)"
    git push -q -u origin HEAD
    echo "Respaldo subido a $PRIV_URL"
    ;;
  restaurar)
    clonar
    mkdir -p "$REPO_DIR/distribucion/manuales" "$MEM_DIR" "$REPO_DIR/.claude"
    cp "$PRIV_DIR"/manuales/*.md "$REPO_DIR/distribucion/manuales/" 2>/dev/null || true
    cp "$PRIV_DIR"/docs_distribucion/*.md "$REPO_DIR/distribucion/" 2>/dev/null || true
    cp "$PRIV_DIR"/claude-memoria/*.md "$MEM_DIR/" 2>/dev/null || true
    [ -f "$REPO_DIR/.claude/settings.local.json" ] || cp "$PRIV_DIR/claude-settings/settings.local.json" "$REPO_DIR/.claude/" 2>/dev/null || true
    echo "Restaurado. Memoria de Claude en: $MEM_DIR"
    ;;
  *)
    echo "Uso: bash scripts/respaldo_privado.sh respaldar|restaurar"; exit 1 ;;
esac
