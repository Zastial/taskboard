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
