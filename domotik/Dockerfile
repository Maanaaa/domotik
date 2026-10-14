FROM node:20-alpine

WORKDIR /app

# Copie des fichiers de dépendances
COPY package*.json ./

# Installation des dépendances
RUN npm install

# Copie du reste des fichiers source
COPY . .

# Exposition du port Next.js
EXPOSE 3000

ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

# Commande par défaut
CMD ["npm", "run", "dev"]
