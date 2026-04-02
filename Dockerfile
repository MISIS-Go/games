FROM denoland/deno:2.6.10

WORKDIR /app

COPY games ./games

WORKDIR /app/games

EXPOSE 8006

CMD ["deno", "run", "--allow-net", "--allow-env", "server.ts"]
