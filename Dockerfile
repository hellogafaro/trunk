FROM ghcr.io/lukilabs/craft-agents-server:latest
USER root
COPY entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
