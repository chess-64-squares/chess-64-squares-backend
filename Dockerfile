# chess-64-squares-backend — standalone build.
# Build context = the PARENT directory holding the sibling project folders:
#   docker build -f chess-64-squares-backend/Dockerfile ..        (from this folder)
FROM node:22-slim AS build
WORKDIR /app

# shared library first (the file:../chess-64-squares-shared dep resolves to it)
COPY chess-64-squares-shared chess-64-squares-shared
RUN cd chess-64-squares-shared && npm install && npm run build

COPY chess-64-squares-backend chess-64-squares-backend
RUN cd chess-64-squares-backend && npm install && npm run build \
 && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/chess-64-squares-backend
EXPOSE 3000
CMD ["node", "dist/main.js"]
