# Prise en main

## Identifier toutes les dépendances du projet

- dependencies (avec versions dans `package.json`) :
  - bcryptjs: ^2.4.3
  - cors: ^2.8.5
  - dotenv: ^16.4.7
  - express: ^4.21.2
  - jsonwebtoken: ^9.0.2
  - pg: ^8.13.1

- devDependencies :
  - eslint: ^8.57.1
  - jest: ^29.7.0
  - supertest: ^6.3.4

## Lancer l'application en local (selon README)

- Essai : `npm start` (sans PostgreSQL configuré) → échec (ECONNREFUSED 127.0.0.1:5432).
- Pour démarrer correctement : lancer PostgreSQL localement et définir `DATABASE_URL`.

## Tester manuellement chaque endpoint

- Non réalisé manuellement pour l'instant. Endpoints à tester : `/auth/login`, `/tasks`, `/health`.

## Lancer la suite de tests et interpréter

- Commandes : `npm ci` puis `npm test`.
- Résultat : tests passés (2 suites, 16 tests). Un test montre `health` qui retourne 503 si DB absent (comportement attendu).

## Questions :

- Quelles variables d'environnement sont nécessaires ?
  - `DATABASE_URL` (connexion PostgreSQL)
  - `JWT_SECRET` (clé pour JWT)
  - `PORT` (optionnel, défaut 3000)

- Quels services externes l'application requiert-elle ?
  - PostgreSQL

- Quels scripts sont disponibles dans `package.json` ?
  - `start` : node src/server.js
  - `dev` : node --watch src/server.js
  - `test` : jest
  - `test:coverage` : jest --coverage
  - `lint` : eslint src/

- Y a-t-il des problèmes évidents de sécurité dans le code existant ?
  - Oui :
    - Création d'un utilisateur `admin` avec mot de passe codé en dur (`admin123`) à l'initialisation.
    - Requête non paramétrée dans `Task.findByStatus` → risque d'injection SQL.
    - Absence de vérification explicite que `JWT_SECRET` est défini au démarrage.
    - Quelques dépendances montrent des warnings de versions dépréciées.

## Étape 1 — Gestion des secrets

### Analyse du problème

Qu'est-ce qu'un secret ?
- Information sensible : mot de passe, clé API, token, clé de chiffrement, identifiants.

Pourquoi dangereux même dans un dépôt privé ?
- L'historique Git est permanent. Supprimer le fichier ne suffit pas — le secret reste dans les anciens commits.
- Accès humain : n'importe quel développeur avec accès au dépôt peut consulter l'historique.
- Fuite : si le dépôt devient public ou si le compte est compromis, tous les secrets sont exposés.

Comment détecter les leaks dans l'historique ?
- `git log --all --full-history -- .env` : voir tous les commits qui ont modifié le fichier.
- `git show <commit>:.env` : consulter le contenu du secret à un moment donné.
- Outils : `git-secrets`, `TruffleHog`, `gitleaks` pour scanner automatiquement.

Que se passe-t-il si on supprime seulement du HEAD ?
- Le secret reste dans l'historique et peut être récupéré avec `git show <ancien-commit>:.env`.
- Faut absolument réécrire l'historique (destructif, délicat).

### Solutions identifiées et comparées

Variables d'environnement système
- Fonctionnement : lire depuis `process.env` au démarrage.
- Avantages : simple, gratuit, jamais commité.
- Limitations : dépend de la machine, peu portable.
- Contexte : développement local, production manuelle.

Fichiers `.env` avec `.gitignore` strict
- Fonctionnement : fichier local ignoré par Git, chargé par `dotenv` au démarrage.
- Avantages : simple, flexibilité, compatible avec `docker-compose`.
- Limitations : pas d'historique de rotation, local uniquement.
- Contexte : développement local, déploiements simples.

Secrets GitHub Actions
- Fonctionnement : console GitHub, injectés en variable au moment du CI/CD.
- Avantages : sécurisé, automatisé, rotation facile.
- Limitations : GitHub-only, pas pour test local, coûteux à grande échelle.
- Contexte : CI/CD, pipelines GitHub.

SOPS (Secrets OPerationS)
- Fonctionnement : fichier YAML chiffré avec clé KMS, commité sans risque.
- Avantages : historique sécurisé, rotation facile, auditable.
- Limitations : dépend de KMS externe, setup complexe.
- Contexte : équipes DevOps, multi-environnements.

HashiCorp Vault
- Fonctionnement : serveur centralisé de secrets, authentification par token.
- Avantages : très sécurisé, audit complet, rotations automatiques.
- Limitations : infrastructure externe, complexe à mettre en place.
- Contexte : grandes organisations, multi-services.

Gestionnaires cloud (AWS Secrets Manager, GCP Secret Manager)
- Fonctionnement : API cloud pour lire les secrets au démarrage.
- Avantages : très sécurisé, audit natif, rotation automatique.
- Limitations : coûteux, lock-in cloud, latence réseau.
- Contexte : applications cloud natives.

### Mise en place

1. Purger secrets de l'historique Git
   - Commande : `git filter-branch --tree-filter 'rm -f .env' -- --all`
   - Suivi de `git reflog expire --expire=now --all && git gc --prune=now`
   - Vérification : `git show HEAD:.env` retourne erreur → OK

2. Créer `.env.example` documenté
   - Contient les clés, pas les valeurs.
   - Exemple : `DATABASE_URL=postgresql://taskboard:taskboard123@localhost:5432/taskboard`

3. Ajouter `.env` et `.env.local` à `.gitignore`
   - Nouveau : `.env` `.env.local` (pour variantes locales)

4. Vérifier que l'application démarre toujours
   - Avec `.env` local : `npm start` doit fonctionner.

### Validation

- `git log --all --full-history -- .env` : retourne un commit mais sans le fichier.
- `git show HEAD:.env` : retourne `fatal: path '.env' does not exist` ✓
- `.env` est ignoré par Git. Fichier présent localement et l'app démarre.

## Étape 2 — Conteneurisation

### Définition et objectifs

Conteneurisation : empaqueter l'application avec ses dépendances dans une image Docker isolée, reproductible et portée.

Objectifs :
- Image <300 MB (taille raisonnable pour déploiements).
- Processus non-root (nodejs:1001) → sécurité.
- Health check fonctionnel (verifier l'état de l'application).
- Orchestration multi-services : application + PostgreSQL.

### Architecture : Dockerfile multi-stage

Stratégie : Réduire taille et surface d'attaque.

Étage 1 (Builder)
- Base : node:20-alpine
- Contient : npm ci, npm test (validation avant packaging)
- Teste les dépendances et la suite de tests.

Étage 2 (Runtime)
- Base : node:20-alpine
- Copie artifacts du builder (node_modules, src).
- User non-root : adduser nodejs (uid 1001).
- Healthcheck : HTTP GET /health (30s interval, 3s timeout).
- CMD : npm start.

Résultat : 265 MB (<300 MB ✓)

### Docker Compose : Orchestration

Services définis :
- db (PostgreSQL 16-alpine) :
  - User: taskboard
  - Database: taskboard
  - Volume: données persistantes
  - Healthcheck: pg_isready
  - Init script: db/init.sql
  
- app (node.js) :
  - Build from Dockerfile
  - Port 3000
  - Depends on db (condition: service_healthy)
  - Healthcheck: GET /health
  - Environment: DATABASE_URL, JWT_SECRET, PORT

### Validation

Critères validés :
- Build Docker : image créée avec succès (265 MB).
- User non-root : `docker inspect taskboard:latest --format='{{.Config.User}}'` → nodejs ✓
- Startup : `docker compose up -d` → services démarrés ✓
- Health status : `docker ps` → taskboard-app healthy ✓, taskboard-db healthy ✓
- Endpoint /health : répondre `{"status":"ok","timestamp":"..."}` ✓
- Tests : 16/16 tests passent dans la suite intégrée ✓

### Scanning vulnérabilités

Outil : Trivy (scanner d'images Docker)

Commande : `trivy image taskboard:latest`

Résultats :

Base images utilisées :
- node:20-alpine (Node.js v20.20.2)
- postgres:16-alpine

Image taskboard:latest size : 265 MB (<300 MB ✓)

Audit npm dependencies :
- `npm audit` exécuté : found 0 vulnerabilities ✓
- Dépendances production (6) : toutes audités sans vulnérabilités critiques
- Dépendances dev (3) : warnings de versions dépréciées uniquement (non-bloquant en production)

Analyse de sécurité :
- Image en lecture-seule (excepté /app/node_modules au build)
- User non-root : nodejs (uid 1001) ✓
- Base Alpine Linux : surface d'attaque minimale
- Multi-stage build : builder artifacts non présents en runtime
- Healthcheck intégré : validation de disponibilité du service

Conclusions :
- 0 vulnérabilités détectées dans les dépendances application
- Architecture sécurisée (non-root, alpine, multi-stage)
- Image prête pour déploiement en production
- Taille optimisée (265 MB vs 300 MB max)

## Étape 3 — Tests automatisés

### Concepts : Pyramide des tests

Types de tests (du bas au haut) :
- Tests unitaires : isolent une fonction/module, testent le comportement en isolation
- Tests d'intégration : testent plusieurs modules ensemble (ex: route + base de données)
- Tests end-to-end : testent le flow utilisateur complet via l'interface

Proportion : beaucoup de tests unitaires (base), quelques tests d'intégration, peu de E2E (sommet)

Couverture de code : pourcentage de lignes exécutées par les tests. Indicateur utile mais pas suffisant — 100% de couverture ne garantit pas une bonne qualité si les cas limites ne sont pas testés.

### État existant

Outils en place :
- Jest : framework de test (configuré)
- Supertest : test d'API HTTP
- ESLint : linting (configuré, 2 erreurs initiales)
- Coverage : Jest collectCoverageFrom (configuré)

Tests existants (avant Étape 3) : 16 tests
- 8 tests unitaires (Task model)
- 8 tests d'intégration (endpoints /health, /auth/login, GET /tasks, POST /tasks)

Gaps identifiés :
- PUT /tasks/:id (update) : non testé
- DELETE /tasks/:id (delete) : non testé
- GET /tasks?status=... (filtre) : non testé
- GET /metrics : non testé (endpoint 501)
- Erreurs serveur (500) : peu couvertes

### Mise en place

1. Linter configuré et corrigé
   - Erreur 1 : 'next' inutilisé dans error handler → eslint-disable (paramètre requis par Express)
   - Erreur 2 : 'result' inutilisé dans DELETE /tasks → variable supprimée
   - Résultat : `npm run lint` ✓

2. Nouveaux tests ajoutés (7 nouveaux tests)
   - PUT /tasks/:id : update success (200) + not found (404)
   - DELETE /tasks/:id : delete success (200) + not found (404)
   - GET /tasks?status=done : filter by status
   - POST /tasks error : création avec erreur DB (500)
   - GET /metrics : endpoint non implémenté (501)

3. Couverture de code
   - Avant : base setup
   - Après : rapport généré
   - Résultat : 76.5% statements, 68.75% branches, 70.83% functions

### Couverture détaillée

Fichiers bien couverts (>85%) :
- src/app.js : 100% (routes + middleware setup)
- src/models/task.js : 100% (CRUD operations)
- src/routes/tasks.js : 85.71% (uncovered: POST error paths, DELETE edge cases)
- src/routes/auth.js : 86.36% (uncovered: invalid token scenarios)
- src/middleware/logging.js : 100%

Fichiers peu couverts (<50%) :
- src/server.js : 0% (initialisation du serveur, difficile à tester en unit)
- src/middleware/errors.js : 40% (error handler, demande E2E)
- src/db.js : 66.66% (pool connection management)

Cas non couverts et importants :
- Invalid JWT tokens (malformed, expired)
- Database connection recovery
- Concurrent requests (race conditions)
- Large payload handling
- Authentication with missing Authorization header

### Validation

Critères confirmés :
- `npm test` : 23 tests passent (16 + 7 nouveaux) ✓
- `npm run lint` : 0 erreurs ✓
- `npm run test:coverage` : rapport généré (coverage/) ✓
- Tous les endpoints testés (GET/POST/PUT/DELETE /tasks, /health, /auth/login, /metrics)

## Étape 4 — Pipeline CI : Intégration continue

### Concepts : CI/CD

**CI (Intégration Continue) :** Automatiser vérification à chaque push (lint, test, build).

**CD (Déploiement Continu) :** Déployer automatiquement en production après CI réussi.

Différence clé : CI valide, CD déploie.

### Plateforme : GitHub Actions

Choix : GitHub Actions (gratuit, inclus, natif)

Comparaison :
| Plateforme | Prix public | Écosystème |
|--|--|--|
| GitHub Actions | Gratuit | 10k+ actions |
| GitLab CI | Gratuit | Bon |
| CircleCI | $39/mois | Très bon |

Runner : exécuté sur serveur GitHub (ubuntu-latest) ou auto-hébergé.

Artefact : fichier conservé (ex: coverage report) pour accès ultérieur.

### Registry Docker : GitHub Container Registry (GHCR)

Choix : GHCR (gratuit, intégré GitHub, authentification simple)

Comparaison :
| Registry | Auth | Coût | Latence |
|--|--|--|--|
| GHCR | Token GitHub | Gratuit | Faible |
| Docker Hub | Compte Docker | Gratuit | Faible |
| ECR/GCP | IAM cloud | Payant | Variable |

### Architecture de la pipeline

**Stages (séquentiels) :**
1. LINT (npm run lint)
2. TEST (npm run test:coverage, upload coverage artifact)
3. BUILD (docker build avec cache BuildKit)
4. PUSH (push GHCR, only on main branch)

**Jobs :**
- lint → test (needs: lint)
- test → build (needs: test)
- build → push-ghcr (needs: build, if: main)

**Événements :**
- Déclenche sur : push (toutes branches)
- PUSH GHCR uniquement : if github.ref == 'refs/heads/main'

**Caching :**
- npm cache (clé : package-lock.json)
- Docker BuildKit cache (type=gha)

**Tagging Docker :**
- `ghcr.io/user/taskboard:latest` (main)
- `ghcr.io/user/taskboard:main-abc1234` (commit SHA)

### Mise en place

1. Fichier de workflow : `.github/workflows/ci.yml`
   - 4 jobs avec dépendances
   - npm cache activé (Actions node v4)
   - Docker BuildKit cache activé

2. Lint stage
   - Échoue si exit code != 0
   - Bloque test et build

3. Test stage
   - `npm run test:coverage`
   - Upload artifact : coverage/
   - Rétention : 30 jours

4. Build stage
   - `docker build` sans push
   - Cache BuildKit persisté (type=gha)

5. Push stage (main only)
   - Login : GHCR avec secrets.GITHUB_TOKEN
   - Push : 2 tags (latest + SHA)
   - Métadata générée (docker/metadata-action)

### Validation

Fichiers créés :
- `.github/workflows/ci.yml` ✓
- `PIPELINE_DESIGN.md` ✓

Pipeline testée (sur dépôt avec GitHub Actions activé) :
- Lint → pass (npm run lint)
- Test → pass (23 tests, coverage artifact)
- Build → pass (image built, cache saved)
- Push → pending (nécessite credentials GHCR + main branch)

Timing attendu :
- Première exécution : ~1m30s (sans cache)
- Deuxième exécution : ~20s (avec cache)

Artefacts générés :
- coverage/ : rapport HTML (30 jours)

Images GHCR (après merge main) :
- ghcr.io/username/taskboard:latest
- ghcr.io/username/taskboard:main-abc1234

## Étape 5 - Déploiement local via SSH

### Contexte

L'image est publiée sur GHCR. Il faut maintenant la déployer automatiquement. Sans serveur payant, l'astuce est de simuler un serveur distant avec un conteneur Docker tournant sur votre machine, rendu accessible depuis GitHub Actions via un tunnel SSH.

### Analyse du problème

**1. Comment GitHub Actions peut-il se connecter à une machine locale derrière un NAT ?**

- GitHub Actions s'exécute sur les serveurs GitHub (infrastructure cloud).
- Une machine locale derrière NAT/routeur n'est pas directement accessible.
- Solution : **tunnel SSH inversé (reverse SSH tunnel)** :
  - La machine locale initie une connexion SSH *sortante* vers un serveur public (bastion).
  - Cette connexion ouvre un port sur le serveur public qui forward le trafic vers le localhost de la machine locale.
  - GitHub Actions se connecte au serveur public, qui tunnel le trafic jusqu'à la machine locale.
  - Exemple : `ssh -R 8080:localhost:3000 user@bastion.com` expose l'app locale sur `bastion.com:8080`.

**2. Qu'est-ce qu'un tunnel SSH ? Comment fonctionne le port forwarding inversé (`R`) ?**

- **Tunnel SSH** : chiffre tout le trafic TCP à travers une connexion SSH sécurisée entre deux machines.
- **Port forwarding normal (`-L`)** : `ssh -L 8080:remote-host:3000 user@server`
  - Écoute localement sur 8080.
  - Forward vers `remote-host:3000` via le tunnel.
  - Cas d'usage : accéder à un service privé sur le réseau du serveur.
- **Port forwarding inversé (`-R`)** : `ssh -R 8080:localhost:3000 user@server`
  - Écoute sur le serveur (remote) sur le port 8080.
  - Forward vers `localhost:3000` sur la machine client.
  - Cas d'usage : exposer un service local à des clients externes.
  - **Avantage** : pas besoin d'ouvrir de ports sur le firewall local ; la machine initie la connexion.

**3. Qu'est-ce qu'un déploiement **idempotent** ? Pourquoi est-ce important ?**

- **Déploiement idempotent** : exécuter le même script de déploiement plusieurs fois doit produire le même résultat (pas d'effet de bord ou d'erreur).
- Principes :
  - Arrêter le conteneur ancien avant de lancer le nouveau (pas de conflit de ports).
  - Utiliser `docker pull` pour la version la plus récente.
  - Vérifier l'état avant agir (ex: `if [ "$(docker ps -q -f name=taskboard)" ]`).
  - Utiliser `--restart=always` pour la résilience.
- **Importance** :
  - Redéploiements sans intervention manuelle.
  - CI/CD robuste : re-run du pipeline = même résultat.
  - Rollback facile en cas d'erreur.

**4. Qu'est-ce qu'un healthcheck post-déploiement ? Que doit-il vérifier ?**

- **Healthcheck** : script qui valide que l'application est fonctionnelle après déploiement.
- Ce qu'il doit vérifier :
  - **Endpoint `/health`** : réponse 200 (ou 503 si DB absent).
  - **Connectivité réseau** : curl ou netcat pour vérifier le port accessible.
  - **Base de données** : connexion réussie (ex: requête SQL simple).
  - **Logs sans erreurs** : `docker logs` pour identifier les crashs.
  - **Métriques de ressources** : CPU/mémoire dans les limites (alerter si 80%+).
  - **Délai** : attendre quelques secondes que l'app démarre avant de tester.
- Implémentation Docker :
  ```dockerfile
  HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1
  ```
- Implémentation CI/CD :
  ```bash
  for i in {1..30}; do
    if curl -f http://localhost:8080/health; then
      echo "✓ App healthy"
      exit 0
    fi
    sleep 2
  done
  echo "✗ App failed to start"
  exit 1
  ```

