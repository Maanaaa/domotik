FROM node:20-alpine

WORKDIR /app

# Copie des fichiers de dépendances depuis domotik
COPY domotik/package*.json ./

# Installation des dépendances
RUN npm install

# Copie des fichiers source
COPY domotik/ .

# Exposition du port Next.js
EXPOSE 3000

ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

# Commande par défaut
CMD ["npm", "run", "dev"]
