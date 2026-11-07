# Traffic Simulator - Volontariapp

Service autonome de simulation de trafic et d'activité en temps réel pour l'écosystème Volontariapp.

## Fonctionnalités Clés
- **Invariant des 20 Arrondissements de Paris** : Maintient en permanence au moins 1 événement `IN_PROGRESS` (en direct) dans chacun des 20 arrondissements (75001 à 75020) avec coordonnées GPS réelles.
- **Cycle de Vie & Posts Réalistes** :
  - Publication d'un post d'ouverture avec photo HD thématique téléversée via MinIO/ms-storage (Cleanwalk, Maraude, Végétalisation, Atelier vélo, etc.).
  - Participations multiples de bénévoles virtuels et interactions.
  - Publication d'un post de fin avec photo de bilan réel et clôture de l'event en `EVENT_STATE_FINISHED`.
- **Peuplement de Masse** : Capacité à pré-peupler jusqu'à 500 événements simultanés.
- **Déploiement K3s Durci** : Profil **PSA Restricted** et NetworkPolicies default-deny.

## Démarrage en Local

```bash
yarn install
API_GATEWAY_URL="http://localhost:3000" TICK_INTERVAL_MS=5000 yarn dev
```
