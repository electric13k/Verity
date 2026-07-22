# syntax=docker/dockerfile:1
# Verity fetch — private-subnet headless-browser render service (backlog G11).
# HTTP /fetch + /healthz on :8400. Reached ONLY by the brain over the compose
# private network (FETCH_SERVICE_URL=http://fetch:8400); never published.
#
# BUILD CONTEXT = services/fetch (self-contained).
#   docker build -f services/fetch/Dockerfile -t verity/fetch services/fetch
# (infra/docker/compose.prod.yaml sets context: ../../services/fetch.)
#
# Base = the OFFICIAL Playwright Python image, tag-matched to the pinned
# playwright==1.56.0 pip package. It ships Chromium (revision 1194) at
# /ms-playwright with every OS dependency preinstalled — so NO `playwright
# install` / browser download ever runs here (the vendored browser is used).
FROM mcr.microsoft.com/playwright/python:v1.56.0-noble AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    # Belt-and-suspenders: never attempt a browser download during install.
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

# Install the app + its deps. playwright==1.56.0 is already present in the base
# image (pip sees it satisfied); the rest are small pure/manylinux wheels.
COPY pyproject.toml ./
COPY app ./app
RUN pip install .

EXPOSE 8400

# Liveness: /healthz always answers 200 even when the browser is degraded (plan
# law). Dependency-free check (no curl assumption), proxy-agnostic.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request as u; u.build_opener(u.ProxyHandler({})).open('http://127.0.0.1:8400/healthz', timeout=4).read()" || exit 1

# pwuser (uid 1000) ships with the Playwright image and owns /ms-playwright.
USER pwuser

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8400"]
