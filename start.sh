#!/usr/bin/env sh
cd services
docker network create bankcorenet
docker compose --env-file .env -f datasebase/docker-compose.yml up -d
docker compose --env-file .env -f fineract/docker-compose.yml up -d
docker compose --env-file .env -f blnk/docker-compose.yml up -d
curl http://localhost:5001/health