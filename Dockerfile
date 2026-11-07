# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copie des fichiers de configuration
COPY package.json tsconfig.json ./

# Installation des dépendances et compilation TypeScript
RUN npm install
COPY src ./src
RUN npm run build

# Stage 2: Runtime durci PSA Restricted
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Installation des dépendances de production uniquement
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copie des artefacts compilés
COPY --from=builder /app/dist ./dist

# Sécurité PSA Restricted : utilisateur non-root 1001
USER 1001

CMD ["node", "dist/index.js"]

