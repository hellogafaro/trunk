#!/bin/sh
set -e
mkdir -p /home/craftagents/.craft-agent
chown -R craftagents:craftagents /home/craftagents/.craft-agent
exec runuser -u craftagents -- bun run packages/server/src/index.ts --allow-insecure-bind "$@"
