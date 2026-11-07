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

## Réactions sociales sur les posts

Quand un vrai utilisateur (hors vivier de simulateurs) publie un post, le simulateur le détecte (scan toutes les 4 s) et planifie un échéancier complet : 12 à 25 likes (environ 40 % dans les 20 premières secondes, le reste sur 3 minutes) et 4 à 8 commentaires (le premier entre 4 et 9 s). Un acteur ne like et ne commente qu'une fois par post. Les posts déjà présents au démarrage ne reçoivent aucune réaction.

| Variable | Défaut | Rôle |
| :--- | :--- | :--- |
| `POST_SCAN_INTERVAL_MS` | `4000` | Fréquence du scan des nouveaux posts |
| `REACTION_TICK_MS` | `1000` | Pas d'exécution des réactions dues |
| `POST_LIKES_MIN` / `POST_LIKES_MAX` | `12` / `25` | Fourchette de likes par post |
| `POST_COMMENTS_MIN` / `POST_COMMENTS_MAX` | `4` / `8` | Fourchette de commentaires par post |
| `TARGET_ACTORS` | `120` | Taille du vivier (300 en production) |
| `ACTOR_BATCH_PAUSE_MS` | `1000` | Pause entre deux lots de création ou renommage de comptes |

Les pseudos et bios sont générés de façon déterministe (`src/actors/actor-identity.ts`). Les comptes existants sont renommés en place au démarrage (`PATCH /users/me`), l'historique est conservé.

## Fenêtre de sommeil

Entre `SLEEP_START_HOUR` et `SLEEP_END_HOUR` (fuseau `SLEEP_TIMEZONE`), le simulateur n'appelle plus l'API : aucun event, aucune réaction. `SLEEP_DRAIN_SEC` avant le début, la création d'events est suspendue ; à l'entrée dans la fenêtre, les events encore actifs sont clôturés. Au réveil, les sessions des acteurs sont rafraîchies. Le pod reste en vie, seul le trafic est coupé.

| Variable | Défaut | Rôle |
| :--- | :--- | :--- |
| `SLEEP_ENABLED` | `false` | Active la fenêtre de sommeil |
| `SLEEP_START_HOUR` / `SLEEP_END_HOUR` | `0` / `8` | Bornes (heure locale, la fenêtre peut passer minuit) |
| `SLEEP_TIMEZONE` | `Europe/Paris` | Fuseau IANA |
| `SLEEP_DRAIN_SEC` | `300` | Marge de vidage avant la fenêtre |

## Tests

```bash
yarn typecheck
yarn test
```
