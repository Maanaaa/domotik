#!/bin/bash
set -e

# Vérification des privilèges root (sudo)
if [ "$EUID" -ne 0 ]; then
  echo "❌ Veuillez exécuter ce script avec sudo : sudo ./install-autostart.sh"
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURRENT_USER="${SUDO_USER:-$USER}"

echo "🔧 Configuration du démarrage automatique au boot..."
echo "📁 Répertoire du projet : $PROJECT_DIR"
echo "👤 Utilisateur d'exécution : $CURRENT_USER"

# Rendre start.sh exécutable
chmod +x "$PROJECT_DIR/start.sh"

SERVICE_FILE="/etc/systemd/system/domotik-autostart.service"

cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=Domotik Git Pull et Lancement Docker
After=network-online.target docker.service
Wants=network-online.target docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$PROJECT_DIR
ExecStart=$PROJECT_DIR/start.sh
User=$CURRENT_USER
StandardOutput=journal+console
StandardError=journal+console

[Install]
WantedBy=multi-user.target
EOF

# Rechargement et activation du service systemd
systemctl daemon-reload
systemctl enable domotik-autostart.service

echo "=========================================================="
echo "✅ Démarrage automatique configuré avec succès !"
echo "Au prochain démarrage du Raspberry Pi :"
echo "1. Le système attend la connexion Internet."
echo "2. Il exécute 'git pull' pour récupérer vos dernières modifications."
echo "3. Il lance 'docker compose up -d --build'."
echo "=========================================================="
