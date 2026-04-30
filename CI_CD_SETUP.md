# GitHub Actions CI/CD Setup Guide

## Configuration requise

### 1. Vérifier que GitHub Actions est activé
- Aller à : Settings → Actions → General
- Vérifier que "Actions permissions" est activé
- Default: Autorisé pour tous les workflows

### 2. Token d'authentification (automatique)
- `secrets.GITHUB_TOKEN` est fourni automatiquement par GitHub
- Permissions : lecture/écriture sur packages (GHCR)
- Aucune configuration manuelle requise

### 3. Structure du repository
- `.github/workflows/ci.yml` ✓ créé
- `PIPELINE_DESIGN.md` ✓ créé
- `Dockerfile` ✓ existe
- `package.json` avec scripts ✓ existe
- `.env` ✓ git-ignored (ne sera pas dans l'image)

## Pipeline Workflow

### Événements de déclenchement

| Événement | Condition | Branches |
|-----------|-----------|----------|
| Push | À chaque push | Toutes |
| Lint stage | Automatique | Toutes |
| Test stage | Après lint réussi | Toutes |
| Build stage | Après test réussi | Toutes |
| Push GHCR | Après build réussi | main uniquement |

### Jobs et dépendances

```
push (any branch)
  ├→ lint (success → test)
  │   └→ test (success → build, upload artifacts)
  │       └→ build (success → push-ghcr if main)
  │           └→ push-ghcr (if: main branch)
```

### Artifacts

- **coverage-report**
  - Path: `coverage/`
  - Rétention: 30 jours
  - Accessible via: Actions → (run) → Artifacts

### Caching

- **npm dependencies**
  - Clé: `package-lock.json`
  - Économies: ~10s par build

- **Docker BuildKit**
  - Type: GitHub Actions cache
  - Économies: ~40s par build

## Images Docker publiées

Après merge sur `main`, l'image est disponible sur GHCR:

```bash
ghcr.io/<USERNAME>/taskboard:latest    # Dernière version
ghcr.io/<USERNAME>/taskboard:main-SHA  # Identifié par commit
```

### Utiliser l'image

```bash
# Login (remplacer TOKEN par GitHub personal access token si nécessaire)
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Pull
docker pull ghcr.io/<USERNAME>/taskboard:latest

# Run
docker run -e DATABASE_URL=... -e JWT_SECRET=... ghcr.io/<USERNAME>/taskboard:latest
```

## Dépannage

### Pipeline échoue au stage lint
- Commande: `npm run lint`
- Solution: Corriger les erreurs ESLint dans src/

### Pipeline échoue au stage test
- Commande: `npm run test:coverage`
- Solution: Vérifier que les tests passent localement

### Pipeline échoue au stage build
- Commande: `docker build`
- Solution: Vérifier Dockerfile et dépendances

### Image ne pousse pas sur GHCR (main branch)
- Cause possible: Token GitHub insuffisant (config workflow)
- Solution: Vérifier que permissions sont correctes dans le workflow
- Alternative: Utiliser PAT (Personal Access Token) en secret

## Étape 5 — Déploiement local via SSH

### Contexte

L'image est publiée sur GHCR. Pour simuler un déploiement sur un serveur distant sans coût, nous utilisons un tunnel SSH pour exposer un conteneur Docker local (serveur SSH) accessible depuis GitHub Actions.

### Architecture

```
GitHub Actions runner
        │
        │  SSH via tunnel public
        ▼
localhost.run (tunnel)
        │
        ▼
Machine locale — port 2222 exposé
        │
        ▼
Conteneur "taskboard-ssh"
(simule serveur distant)
  - OpenSSH server
  - Accès socket Docker hôte
  - Authentification par clé SSH
        │
        │  docker pull + docker run
        ▼
Conteneur "taskboard-app"
(application déployée)
```

### Prérequis

#### 1. Générer la clé SSH
```bash
ssh-keygen -t ed25519 -f ~/.ssh/localhost_run -N ''
```

#### 2. Ouvrir le tunnel
```bash
./start-tunnel.sh
```
- Note l'URL publique affichée (ex: `https://xxxxx.localhost.run`)
- Le tunnel expose le port 2222 (SSH) sur cette URL

#### 3. Démarrer l'environnement local
```bash
docker-compose up -d ssh-server
```

#### 4. Configurer les secrets GitHub
- `SSH_PRIVATE_KEY`: Contenu de `~/.ssh/localhost_run` (clé privée)
- `TUNNEL_HOST`: Domaine du tunnel (ex: `xxxxx.localhost.run`)
- `TUNNEL_PORT`: `80` (port exposé par localhost.run)

### Déploiement automatique

Le job `deploy` s'exécute uniquement sur `main` après le push GHCR réussi.

#### Critères de validation
- ✅ Push sur `main` déclenche la pipeline complète
- ✅ Application accessible sur `http://localhost:3000` après déploiement
- ✅ Script idempotent (relance sans erreur)
- ✅ Pipeline en erreur si healthcheck échoue

### Outils de tunnel comparés

| Outil | Gratuit | Installation | Compte requis | URL stable | Durée session | Fiabilité |
|-------|---------|--------------|---------------|------------|--------------|-----------|
| localhost.run | ✅ | Aucune | Non | Non (aléatoire) | ∞ (persistent) | Moyenne |
| ngrok | ⚠️ (1h/jour) | CLI | Oui | Oui (payant) | 8h gratuit | Élevée |
| Cloudflare Tunnel | ✅ | CLI | Oui | Oui | ∞ | Élevée |
| Pinggy | ✅ | CLI | Non | Non | 1h | Faible |
| serveo.net | ✅ | Aucune | Non | Non | ∞ | Moyenne |

**Choix : localhost.run** - Simple, gratuit, pas de compte requis.

### Sécurité

- Clé SSH dédiée au déploiement
- Pas de mot de passe (authentification par clé uniquement)
- Accès Docker limité au socket (pas de root)
- Tunnel chiffré (SSH)

### Dépannage déploiement

#### Tunnel ne se connecte pas
- Vérifier que `ssh-server` est démarré
- Vérifier la clé publique dans `authorized_keys`
- Tester connexion locale: `ssh -p 2222 deploy@localhost`

#### Déploiement échoue
- Vérifier secrets GitHub corrects
- Vérifier image disponible sur GHCR
- Logs: Actions → deploy job → SSH output

#### Healthcheck échoue
- Vérifier DB et app démarrés: `docker ps`
- Vérifier logs: `docker logs taskboard-app`
- Tester endpoint: `curl http://localhost:3000/health`

## Performance

### Timing type

**Première exécution (sans cache):**
- Lint: ~5s
- Test: ~10s (npm install + coverage)
- Build: ~60s (npm install docker, image layers)
- Push: ~30s (upload image)
- **Total: ~1m45s**

**Exécutions suivantes (avec cache):**
- Lint: ~3s (npm cache hit)
- Test: ~5s (npm cache hit)
- Build: ~20s (docker layer cache hit)
- Push: ~15s (upload)
- **Total: ~45s**

## Sécurité

### Secrets utilisés
- `secrets.GITHUB_TOKEN` : Automatique, read/write packages
- Aucun secret applicatif commité (.env ignoré)

### Best practices appliquées
- Minimal permissions (contents:read, packages:write)
- Non-root user dans l'image
- Multi-stage Docker build
- Cache validé (BuildKit)
- Image taggée par commit SHA (traçabilité)

## Prochaines étapes (hors scope)

- Tests E2E avec Playwright
- SonarQube/CodeFactor pour qualité
- Scan de vulnérabilités (Trivy) dans pipeline
- Déploiement automatique (CD) vers Kubernetes/Cloud
- Notifications Slack/Email sur échecss
