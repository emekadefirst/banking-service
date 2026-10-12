#!/usr/bin/env sh
set -e
cd services
docker network create bankcorenet 2>/dev/null || true
docker compose --env-file ../.env -f datasebase/docker-compose.yml up -d
docker compose --env-file ../.env -f fineract/docker-compose.yml up -d
docker compose --env-file ../.env -f blnk/docker-compose.yml up -d
docker compose --env-file ../.env -f middleware/docker-compose.yml up -d

curl -fsS http://localhost:3000/health