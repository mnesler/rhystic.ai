# Agent Rules

## Build & Deploy Rules

- Never run `gcloud run deploy` or push images to Artifact Registry directly
- All deploys must go through GitHub Actions:
  - Preprod: push or merge to `main` (triggers `build.yml`)
  - Prod: run `promote.yml` manually in GitHub Actions
- `docker build` and `docker run` are fine locally for development and testing
- Do not push Docker images to Artifact Registry outside of CI
