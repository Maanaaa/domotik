#!/bin/bash
set -e

# Se placer dans le répertoire du projet quel que soit l'endroit d'où le script est exécuté
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================================="
echo "🚀 [$(date '+%Y-%m-%d %H:%M:%S')] Démarrage de Domotik"
echo "=========================================================="

# 1. Attente du réseau et de l'accès Internet (max 30 secondes)
echo "🌐 Vérification de la connexion Internet (attente du réseau au boot)..."
RETRY=0
MAX_RETRIES=15
ONLINE=0

while [ $RETRY -lt $MAX_RETRIES ]; do
  if ping -c 1 -W 2 github.com > /dev/null 2>&1; then
    ONLINE=1
    echo "✅ Connexion Internet établie !"
    break
  fi
  RETRY=$((RETRY+1))
  echo "⏳ En attente du réseau... ($RETRY/$MAX_RETRIES)"
  sleep 2
done

# 2. Mise à jour automatique Git si Internet est disponible
if [ $ONLINE -eq 1 ]; then
  echo "📥 Mise à jour depuis GitHub (git pull origin main)..."
  git pull origin main || git pull || echo "⚠️ Avertissement : Impossible de faire git pull, utilisation de la version locale."
else
  echo "⚠️ Aucune connexion Internet disponible. Démarrage avec la version locale existante."
fi

# 3. S'assurer que le réseau Docker externe existe
if ! docker network inspect proxy_network > /dev/null 2>&1; then
  echo "🌐 Création du réseau Docker 'proxy_network'..."
  docker network create proxy_network
fi

# 4. Lancement de Docker Compose avec rebuild automatique
echo "📦 Lancement des conteneurs Docker Compose..."
if docker compose version > /dev/null 2>&1; then
  docker compose up -d --build
else
  docker-compose up -d --build
fi

echo "=========================================================="
echo "✅ [$(date '+%Y-%m-%d %H:%M:%S')] Domotik est prêt et en ligne !"
echo "=========================================================="
