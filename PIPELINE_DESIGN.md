# Pipeline Design — CI/CD pour Taskboard

## Vue d'ensemble

### Qu'est-ce que CI/CD ?

**CI (Intégration Continue) :** Automatiser la vérification du code à chaque push (build, tests, lint).

**CD (Déploiement Continu) :** Automatiser le déploiement en production après CI réussi.

Différence : CI teste et valide; CD déploie automatiquement.

### Plateforme : GitHub Actions

Choix : **GitHub Actions** (inclus gratuitement, natif, pas de configuration externe)

Comparaison rapide :
| Plateforme | Prix public | Syntaxe | Écosystème | Courbe |
|--|--|--|--|--|
| GitHub Actions | Gratuit | YAML standard | 10k+ actions | Facile |
| GitLab CI | Gratuit | YAML spécifique | Bon | Moyenne |
| CircleCI | $39/mois | YAML custom | Très bon | Moyenne |

Runner : s'exécute sur serveur GitHub (ubuntu-latest par défaut) ou auto-hébergé.

Artefact : fichier généré par une étape, conservé pour utilisation ultérieure (ex: coverage report).

### Registry Docker : GitHub Container Registry (GHCR)

Choix : **GHCR** (gratuit, intégré GitHub, authentification simple par token)

Comparaison :
| Registry | Authentification | Stockage public | Latence | Coût |
|--|--|--|--|--|
| GHCR | Token GitHub | Gratuit | Faible | Gratuit |
| Docker Hub | Compte Docker | Gratuit | Faible | Gratuit (limite pull) |
| ECR/GCP | IAM cloud | Gratuit | Variable | Payant |

## Architecture de la Pipeline

### Stages

```
LINT      → TEST (+ coverage) → BUILD (Docker) → PUSH (GHCR)
```

### Jobs par stage

**Stage 1 — LINT (déclenchement : push sur any branch)**
- Job : lint
  - Run: npm run lint
  - Fail if: exit code != 0
  - Duration: ~5s

**Stage 2 — TEST (déclenchement : après LINT réussi, any branch)**
- Job : test
  - Run: npm run test:coverage
  - Artifacts: coverage/
  - Cache: node_modules (input: package-lock.json)
  - Duration: ~10s
- Dependency: needs lint

**Stage 3 — BUILD (déclenchement : après TEST réussi, any branch)**
- Job : build
  - Run: docker build
  - BuildKit cache enabled
  - Duration: ~1m (première fois), ~20s (avec cache)
- Dependency: needs test

**Stage 4 — PUSH (déclenchement : après BUILD réussi, ONLY main branch)**
- Job : push-ghcr
  - Login: GHCR avec GitHub token
  - Push: ghcr.io/username/taskboard:latest, ghcr.io/username/taskboard:SHA
  - Duration: ~30s
  - Only: if: github.ref == 'refs/heads/main'
- Dependency: needs build

### Événements

- `on: [push]` — déclenche à chaque push
- Branches filtrées sur push GHCR uniquement (main)

### Artefacts

- `coverage/` — rapport de couverture HTML (conservé 30 jours par défaut)

### Caching

- **npm cache** : `~/.npm/` avec clé `package-lock.json`
- **Docker BuildKit cache** : `type=gha` (GitHub Actions cache)

### Tagging

```
ghcr.io/user/taskboard:latest     → pointe vers main
ghcr.io/user/taskboard:SHA        → identifie commit spécifique (ex: abc1234)
```

## Variables d'environnement

- `REGISTRY` : ghcr.io
- `IMAGE_NAME` : ${{ github.repository }}  (github.com/user/taskboard → taskboard)
- `GHCR_TOKEN` : ${{ secrets.GITHUB_TOKEN }} (automatique)

## Timing attendu

- **Première exécution (sans cache):** ~1m30s (npm install + test + docker build)
- **Deuxième exécution (avec cache):** ~20s (npm hit + test hit + docker layer cache hit)
