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
| `FORCE_IDENTITY_SYNC` | `false` | Vérifie et corrige les pseudos de tous les comptes au démarrage |

Les pseudos et bios sont générés de façon déterministe (`src/actors/actor-identity.ts`). Les comptes existants sont renommés en place (`PATCH /users/me`), l'historique est conservé. Pour ne pas réécrire 300 comptes à chaque redéploiement, le simulateur lit d'abord trois comptes sentinelles (premier, milieu, dernier, `GET /users/me`) : s'ils portent déjà leur pseudo cible, la phase est sautée. Sinon, chaque compte est lu et seuls ceux en écart sont écrits. `FORCE_IDENTITY_SYNC=true` force cette vérification complète (un écart isolé hors sentinelles n'est sinon pas détecté).

## Renouvellement de session sur 401

Les access tokens expirent. Toute requête authentifiée qui reçoit un 401 (client API et upload de médias) déclenche un renouvellement de la session de l'acteur concerné, puis est rejouée une seule fois avec le nouveau token :

1. `POST /users/refresh` avec le refresh token de l'acteur ;
2. en secours, re-login avec email et mot de passe (3 tentatives).

Les 401 concurrents d'un même acteur partagent un seul renouvellement réseau. Un second 401 après renouvellement n'est pas rejoué (pas de boucle). Les renouvellements sont journalisés en une ligne agrégée toutes les 10 s.

En prévention, le simulateur vérifie le claim `exp` des access tokens toutes les `TOKEN_CHECK_INTERVAL_SEC` secondes et renouvelle ceux qui expirent dans moins de `TOKEN_REFRESH_AHEAD_SEC`. Les 401 n'apparaissent donc qu'en cas d'échec de ce renouvellement préventif. Pendant la fenêtre de sommeil, cette vérification est suspendue.

| Variable | Défaut | Rôle |
| :--- | :--- | :--- |
| `TOKEN_REFRESH_AHEAD_SEC` | `300` | Renouvelle un token expirant dans moins de ce délai |
| `TOKEN_CHECK_INTERVAL_SEC` | `60` | Fréquence de vérification des expirations |

## Events autour des utilisateurs

Pour qu'un utilisateur reel voie de l'activite pres de lui, quel que soit l'endroit, le simulateur cree des events en direct dans un rayon autour de chaque centre. Les events parisiens et le pool principal ne changent pas. Desactive tant qu'aucun centre n'est donne.

**D'ou viennent les centres**
- **Automatiquement** : avec `SIMULATOR_ADMIN_EMAIL` et `SIMULATOR_ADMIN_PASSWORD` (un compte ADMIN dedie), le simulateur lit a chaque vague `GET /ranking/admin/active-locations`. La route renvoie les positions des utilisateurs qui en ont envoye une dans les `LOCAL_ACTIVE_MAX_AGE_MIN` dernieres minutes, arrondies a 1 km et dedoublonnees, sans aucun identifiant. Les comptes du simulateur n'envoient jamais de position : seuls de vrais utilisateurs apparaissent. Quand un utilisateur ferme l'app, sa cellule sort de la liste au bout de ce delai.
- **A la main** : `LOCAL_CENTERS="lat,lng;lat,lng"`, en plus ou a la place. Utile pour forcer un lieu de test.
- Si la lecture automatique echoue (route indisponible, identifiants refuses), la vague continue avec les centres fixes.

**Ce que fait une vague** (toutes les `LOCAL_EVENTS_INTERVAL_SEC`, 5 min)
- `LOCAL_EVENTS_MIN` a `LOCAL_EVENTS_MAX` events par centre, avec au plus `LOCAL_MAX_CENTERS` centres (les centres fixes d'abord, puis un tirage au hasard parmi les cellules).
- Chaque event est pose sur un point tire uniformement dans le rayon. Une position decouverte est arrondie a 1 km : le rayon de sa cellule est reduit de 710 m (la moitie de la diagonale) pour que l'event reste dans `LOCAL_RADIUS_METERS` de l'utilisateur, ou quasi, quel que soit son point exact dans la cellule.
- Le point est converti en adresse reelle (reverse-geocodage OpenStreetMap Nominatim, 1 requete par seconde au plus) : `post-processor-event` geocode ensuite cette adresse et pose les coordonnees. Si le point n'a pas d'adresse, 3 points sont essayes avant d'abandonner l'event.
- Meme cycle de vie que les events parisiens (cover, post d'ouverture, participants, emargement, bilan, cloture), avec une duree de `LOCAL_EVENT_LIFESPAN_SEC`.
- Les organisateurs et participants sont un pool distinct de `LOCAL_ACTORS` comptes (`local.NNNN@simulator.volontariapp.test`), avec des pseudos et bios sans arrondissement. Leurs posts ne declenchent aucune reaction automatique.
- La fenetre de sommeil s'applique : plus de vague pendant le vidage, events clotures a l'entree dans la fenetre.

**Vie privee** : les positions ne sont ni journalisees ni stockees par le simulateur, qui ne garde que les cellules de la derniere lecture en memoire. La route est reservee aux admins cote gateway et cote `ms-ranking`.

| Variable | Defaut | Role |
| :--- | :--- | :--- |
| `SIMULATOR_ADMIN_EMAIL` / `SIMULATOR_ADMIN_PASSWORD` | vide | Compte ADMIN du simulateur (secret) : active la lecture des positions |
| `LOCAL_CENTERS` | vide | Centres fixes `lat,lng;lat,lng` |
| `LOCAL_MAX_CENTERS` | `10` | Plafond de centres par vague |
| `LOCAL_ACTIVE_MAX_AGE_MIN` | `30` | Age maximal d'une position consideree comme active |
| `LOCAL_ACTORS` | `40` | Comptes "gens du coin", en plus de `TARGET_ACTORS` |
| `LOCAL_RADIUS_METERS` | `2000` | Rayon autour de chaque centre |
| `LOCAL_EVENTS_INTERVAL_SEC` | `300` | Delai entre deux vagues |
| `LOCAL_EVENTS_MIN` / `LOCAL_EVENTS_MAX` | `1` / `2` | Events par vague et par centre |
| `LOCAL_EVENT_LIFESPAN_SEC` | `900` | Duree d'un event en direct |
| `LOCAL_GEOCODER_USER_AGENT` | `VolontariApp-TrafficSimulator/1.0` | User-Agent envoye a Nominatim |

En local (`NODE_ENV=local`), `post-processor-event` saute le geocodage : les events n'ont alors pas de coordonnees.

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
