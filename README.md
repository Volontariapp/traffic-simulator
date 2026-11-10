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

## Relations, activité de fond et montée en charge

Trois moteurs donnent au réseau l'allure d'une vraie communauté. Ils tournent dans le même pod que le reste et respectent la fenêtre de sommeil.

**Graphe de follow entre acteurs** (`SocialGraphEngine`). Chaque acteur du pool principal en suit `SOCIAL_FOLLOWS_MIN` à `SOCIAL_FOLLOWS_MAX`, avec une préférence pour les comptes populaires (queue longue : quelques comptes très suivis, la plupart peu), et `SOCIAL_RECIPROCITY_PERCENT` % des cibles suivent en retour. Le plan est une fonction pure des emails (`src/social/follow-plan.ts`) : un redéploiement retrouve exactement les mêmes liens, et un acteur absent ne change pas ceux des autres. Au démarrage, trois liens sentinelles (premier, milieu, dernier) sont lus avec `GET /social/users/:id/is-following` : s'ils existent, rien n'est écrit. Sinon le plan est appliqué en arrière-plan, `SOCIAL_FOLLOW_CONCURRENCY` appels à la fois avec `SOCIAL_FOLLOW_PAUSE_MS` entre deux lots, pour ne pas saturer `ms-social` et Neo4j. Un 409 (lien déjà présent) compte comme un succès. Avec 1500 acteurs : environ 34 000 liens, une trentaine de minutes la première fois. `FORCE_SOCIAL_SYNC=true` rejoue tout le plan.

**Activité de fond** (`AmbientActivityEngine`). En continu, des acteurs likent et commentent les posts des simulateurs (events parisiens et locaux, 50 derniers posts relus toutes les 15 s). Un acteur ne like et ne commente qu'une fois par post, les textes de commentaires ne se répètent pas sur un même post, et les posts des comptes qu'un acteur suit pèsent 4 fois plus dans son tirage. Les posts de vrais utilisateurs sont exclus : `UserReactionEngine` s'en charge avec son propre échéancier. Une rafale optionnelle (`AMBIENT_BURST_SIZE`) reproduit un pic d'utilisateurs simultanés ; `AMBIENT_MAX_CONCURRENCY` borne le nombre d'appels en vol, rafale comprise.

**Followers des vrais comptes** (`RealUserFollowEngine`). Avec le compte ADMIN du simulateur, la liste `GET /users` est parcourue en entier (pages de 500) toutes les `REAL_USERS_SCAN_INTERVAL_SEC` secondes. Chaque compte réel nouveau (ni acteur, ni email du domaine du simulateur, ni le compte admin) est suivi par `REAL_FOLLOWERS_MIN` à `REAL_FOLLOWERS_MAX` acteurs tirés au hasard, étalés entre 5 s et 10 min pour éviter une rafale de notifications. `REAL_FOLLOW_EXISTING=true` traite aussi les comptes déjà présents au démarrage ; un redémarrage ne crée ni doublon ni nouvelle notification (409). La liste n'a ni date ni ordre garanti : le moteur compare à l'ensemble déjà vu.

| Variable | Défaut | Rôle |
| :--- | :--- | :--- |
| `SOCIAL_GRAPH_ENABLED` | `true` | Active le graphe de follow |
| `SOCIAL_FOLLOWS_MIN` / `SOCIAL_FOLLOWS_MAX` | `5` / `30` | Follows sortants par acteur |
| `SOCIAL_RECIPROCITY_PERCENT` | `30` | Part des cibles qui suivent en retour |
| `SOCIAL_FOLLOW_CONCURRENCY` | `10` | Appels de follow simultanés pendant la construction |
| `SOCIAL_FOLLOW_PAUSE_MS` | `500` | Pause entre deux lots d'écriture |
| `FORCE_SOCIAL_SYNC` | `false` | Rejoue tout le plan malgré les sentinelles |
| `AMBIENT_ENABLED` | `true` | Active l'activité de fond |
| `AMBIENT_ACTIONS_PER_SEC` | `8` | Débit continu (likes et commentaires) |
| `AMBIENT_COMMENT_PERCENT` | `15` | Part des actions qui sont des commentaires |
| `AMBIENT_MAX_LIKES_PER_POST` / `AMBIENT_MAX_COMMENTS_PER_POST` | `150` / `25` | Plafonds par post |
| `AMBIENT_BURST_SIZE` | `0` | Actions par rafale (0 : pas de rafale) |
| `AMBIENT_BURST_INTERVAL_MIN` | `30` | Délai entre deux rafales |
| `AMBIENT_MAX_CONCURRENCY` | `250` | Appels simultanés maximum |
| `REAL_FOLLOWERS_ENABLED` | `true` | Active les followers des vrais comptes (compte ADMIN requis) |
| `REAL_FOLLOWERS_MIN` / `REAL_FOLLOWERS_MAX` | `6` / `15` | Acteurs qui suivent chaque compte réel |
| `REAL_USERS_SCAN_INTERVAL_SEC` | `120` | Fréquence de lecture de la liste des utilisateurs |
| `REAL_FOLLOW_EXISTING` | `true` | Inclut les comptes déjà présents au démarrage |

**Passer à 1500 acteurs.** `TARGET_ACTORS=1500` (et `LOCAL_ACTORS=200`). Le pool principal écarte désormais les pseudos du pool local (`reservedLocalPseudos`), indispensable au-delà de 1000 acteurs ; les 1000 premiers acteurs gardent exactement leur identité. Le rôle organisateur reste 25 % du pool : les comptes d'index 75 à 374, volontaires jusque-là, deviennent organisateurs en mémoire (leur bio en base n'est pas réécrite, seul le pseudo est réconcilié). Le démarrage se connecte ou crée 1500 comptes par lots de 20 (hachage de mot de passe côté `ms-user`) et le réveil après la fenêtre de sommeil rafraîchit 1500 sessions : prévoir plusieurs minutes. Mesurer avant d'ajouter des pods : le goulot est la gateway, `ms-social` et `ms-post`, pas ce process.

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

## Rampe de charge (lecture seule)

Outil separe du simulateur d'activite : il cherche la limite du projet en montant le debit par paliers.
Il se lance depuis une machine hors du cluster (sinon la charge consomme la RAM de l'hote mesure) et ne fait que des lectures.

```bash
LOAD_BASE_URL="https://<gateway>" LOAD_STEPS="50,100,200" yarn load
```

Coupez d'abord l'activite de fond du simulateur (`AMBIENT_ACTIONS_PER_SEC=0` ou deploiement a 0 replica) : elle s'ajoute au debit mesure.

- Boucle ouverte : le debit est tenu par l'horloge, il ne baisse pas quand le serveur ralentit. Les requetes en vol sont plafonnees (`LOAD_MAX_IN_FLIGHT`), au-dela elles sont comptees `dropped` et comptent comme erreurs.
- Arret automatique : `LOAD_ABORT_WINDOWS` fenetres consecutives (de `LOAD_WINDOW_SECONDS`) avec des erreurs (5xx, reseau, delai, dropped) ou des 429 au-dessus de `LOAD_ABORT_ERROR_RATE`, ou un p95 au-dessus de `LOAD_ABORT_P95_MS`. Un 429 soutenu arrete aussi la rampe : un rate limit repond vite, sans lui le palier paraitrait sain alors que la mesure n'est plus celle de l'application. Les 206 (fallback gateway) sont comptees a part.
- Gateway publique derriere Cloudflare Access : exporter les memes variables que `nativapp/.env` (`CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, renseignees ensemble). Elles sont envoyees en `CF-Access-Client-Id` et `CF-Access-Client-Secret` (login des acteurs compris), jamais journalisees ni ecrites dans le rapport.
- macOS : monter la limite de descripteurs avant le run (`ulimit -n 10240`), la valeur par defaut (256) coupe les connexions bien avant 1 000 req/s.
- Confirmation avant chaque palier (`LOAD_CONFIRM=false` pour la couper). Ctrl+C termine la fenetre en cours.
- Chaque requete porte `X-Load-Test: 1` pour filtrer le trafic dans Datadog. Les horodatages de chaque palier sont dans le rapport.

**Mode app (lectures de toute l'application).** `LOAD_MODE=app` remplace les 5 routes de reference par les lectures que nativapp envoie vraiment, melange `app-v1` (`src/load/app/app-profile.ts`, poids hypothetiques a recaler sur Datadog) : accueil sur `GET /ranking/feed` et resume des likes (`POST /social/likes-summary`, une lecture), swipe sur `GET /ranking/events`, recherche d'events (repli du swipe et carte en direct), detail d'un event, participants, posts lies, commentaires, profils, `is-following`, listes personnelles, classement. Les routes de detail visent un post, un event ou un utilisateur vu dans une reponse precedente ; tant qu'aucun n'est connu, la requete part sur la liste qui en fournit et compte sous ce nom. Avant le premier palier, 5 acteurs lisent 4 listes (hors mesure) pour remplir ces identifiants. Les ecritures du profil ne sont pas encore executables. `LOAD_MODE=routes` (defaut) garde exactement les requetes de reference.

```bash
LOAD_MODE=app LOAD_STEPS="10" LOAD_STEP_SECONDS=60 yarn load
LOAD_MODE=app LOAD_MIX="ranking-feed:3,likes-summary:2,me:1" yarn load   # sous-ensemble des routes d'app
```

**Pool d'ecriture et nettoyage.** Les ecritures de la rampe ne partent que de comptes `load.NNNN@simulator.volontariapp.test` (troisieme pool, pseudos distincts des pools principal et local) et ne visent que des objets du pool : des events de fixture en DRAFT (prefixe `[charge] `, jamais publies, donc absents du ranking et des listes des vrais utilisateurs) et les autres comptes load.

```bash
yarn load:setup                  # cree les comptes absents et LOAD_FIXTURE_EVENTS events DRAFT (une fois)
yarn load:cleanup --dry-run      # compte ce que le pool a ecrit, sans rien toucher
yarn load:cleanup                # retire follows, souhaits et participations, puis relit tout (code 2 s'il reste quelque chose)
yarn load:cleanup --purge        # retire aussi les events de fixture
```

Le nettoyage lit les listes du graphe social (`/social/follows`, `/social/events/{wished,participated}`), ne retire que les relations vers des objets du pool et signale les autres sans les toucher. Hors `setup`, un compte absent est ignore, jamais cree. Variables : `LOAD_POOL_ACTORS` (200), `LOAD_FIXTURE_EVENTS` (10), plus `LOAD_BASE_URL` et le jeton Cloudflare Access comme `yarn load`.

**Ecritures en mode app (`LOAD_WRITES`).** Absent ou `off` : lectures seules. `default` : les ecritures invisibles des vrais utilisateurs, souhait et participation (bascules sur les events DRAFT du pool), follow et unfollow entre comptes load, passes du swipe (lots de 5) sur ces events. Liste explicite pour aller plus loin : `ranking-refresh`, `like-toggle`, `comment-cycle`, `post-cycle` (posts texte du pool, visibles dans les fils pendant leur vie de 60 s, commentaires de 30 s). `location` et `event-cycle` sont refusees. Chaque ecriture part d'un compte `load.NNNN` (jeton du pool, pas celui de l'acteur de lecture) ; une paire deja en vol n'est pas rejouee ; un 409 ou un 404 recale l'etat. En fin de rampe, le nettoyage du pool tourne seul et relit tout (code 2 s'il reste quelque chose). Prealable : `yarn load:setup`.

```bash
LOAD_MODE=app LOAD_WRITES=default LOAD_STEPS="10" LOAD_RAMP_UP_SECONDS=10 yarn load
LOAD_MODE=app LOAD_WRITES=default,like-toggle,comment-cycle,post-cycle yarn load   # second passage
```

**Sonde des effets asynchrones.** Quand `like-toggle` ou `comment-cycle` sont actives, les `LOAD_PROBE_SOCKETS` (20) premiers comptes load ouvrent un socket comme nativapp (`/api/v1/socket.io`, websocket). Chaque like ou commentaire accepte par la gateway attend son message `post.liked` ou `post.comment.created` adresse a l'emetteur (`isEmitter: true`) : le delai couvre outbox, Redis Stream, post-processor de ws-service et envoi. Par fenetre : recus, perdus (au-dela de `LOAD_PROBE_LOST_AFTER_MS`, 60 s), p50 et p95. Arret automatique si le p95 depasse `LOAD_ABORT_ASYNC_P95_MS` (30 s) ou si plus de `LOAD_ABORT_ASYNC_LOST_RATE` (2 %) des effets sont perdus, deux fenetres de suite. Les ecritures par defaut (souhait, participation, follow, passe) n'envoient aucun message WebSocket : leur suivi passe par l'enregistreur `async.log` de la skill `volontariapp-load-ramp`. Attention : ws-service diffuse aussi chaque like et commentaire a tous les clients connectes (`broadcastExcept`), vrais utilisateurs compris.

**Demarrage a froid et montee rapide.** Par defaut, chaque palier part a plein debit et ses `LOAD_WARMUP_SECONDS` premieres secondes sont jetees. Pour mesurer ce que vivent les utilisateurs pendant une attaque, lire le debut a part :

```bash
# attaque brutale : 0 a 200 req/s d'un coup, les 10 premieres secondes lues seconde par seconde
LOAD_STEPS="200" LOAD_WARMUP_SECONDS=0 LOAD_ONSET_SECONDS=10 yarn load
# montee rapide : 0 a 300 req/s en 5 s, puis 60 s de mesure
LOAD_STEPS="300" LOAD_RAMP_UP_SECONDS=5 LOAD_WARMUP_SECONDS=0 LOAD_ONSET_SECONDS=15 yarn load
```

Le debut de palier range chaque requete selon la seconde ou elle est partie (une requete lancee a la seconde 2 qui repond en 8 s compte dans la seconde 2). Il apparait dans le tableau final (« Debut de palier ») et, seconde par seconde, dans `steps[].onset.series` du rapport JSON. L'arret automatique s'applique aussi pendant ce debut : pour laisser passer un depart lent, relever `LOAD_ABORT_WINDOWS` ou `LOAD_ABORT_P95_MS`.

| Variable | Defaut | Role |
| :--- | :--- | :--- |
| `LOAD_BASE_URL` | obligatoire | Gateway visee (aucune valeur par defaut) |
| `LOAD_STEPS` | `50,100,200,400,800,1000` | Debits cibles en req/s |
| `LOAD_STEP_SECONDS` / `LOAD_WARMUP_SECONDS` | `60` / `10` | Duree de mesure et echauffement par palier |
| `LOAD_MODE` | `routes` | `routes` : 5 routes de reference ; `app` : lectures de nativapp (`app-v1`) |
| `LOAD_WRITES` | `off` | Ecritures du mode app : `off`, `default` ou liste de routes d'ecriture |
| `LOAD_POOL_ACTORS` | `200` | Comptes `load.NNNN` ouverts pour les ecritures |
| `LOAD_PROBE_SOCKETS` | `20` | Sockets de la sonde asynchrone (0 : sans sonde) |
| `LOAD_ABORT_ASYNC_P95_MS` / `LOAD_ABORT_ASYNC_LOST_RATE` | `30000` / `0.02` | Seuils d'arret sur les effets asynchrones |
| `LOAD_RAMP_UP_SECONDS` | `0` | Montee lineaire de 0 au debit du palier, avant l'echauffement et hors statistiques (0 : plein debit des la premiere seconde) |
| `LOAD_ONSET_SECONDS` | `0` | Lit a part les N premieres secondes du palier (montee et echauffement compris), avec une serie par seconde ; 0 : desactive |
| `LOAD_ACTORS` | `200` | Comptes existants utilises (memes identites que le pool principal, aucun renommage) |
| `LOAD_MIX` | `events-list:40,posts-list:30,me:20,is-following:10` | Routes et poids. Routes : `events-list`, `events-list-app`, `posts-list`, `me`, `is-following`. `events-list-app` ajoute les filtres de nativapp (`excludeBlockedUsers`, `excludeParticipatedByMe`, `excludeCreatedByMe`, `excludeWishedByMe`), qui coutent des appels pagines a ms-social : l'utiliser a la place de `events-list` pour une mesure fidele a l'application |
| `LOAD_TIMEOUT_MS` | `10000` | Delai par requete |
| `LOAD_REPORT_PATH` | `load-report.json` | Rapport JSON, tableau affiche en fin de run |
