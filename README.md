# skribblGame

Монорепозиторий игры в стиле skribbl с разделением на клиент, сервер и общий пакет типов/контрактов.

## Stack

- Node.js `24.14.0` (зафиксирован в `.nvmrc`)
- npm workspaces
- TypeScript `5.x`
- ESLint `9.x`
- Prettier `3.x`

## Repository Structure

```text
apps/
  client/     # frontend package
  server/     # backend package
packages/
  shared/     # shared contracts/types
docs/
  docs/code-style/git.md
docker-compose.yml
```

## Requirements

- Установленный Node.js версии `24.14.0`
- В проекте включен `engine-strict=true` (`.npmrc`), поэтому версия Node должна совпадать

## Installation

```bash
npm install
```

## Available Commands

Из корня репозитория:

- `npm run lint` — запускает ESLint во всех workspace-пакетах
- `npm run type-check` — запускает проверку типов во всех workspace-пакетах
- `npm run format` — проверяет форматирование Prettier
- `npm run format:write` — исправляет форматирование Prettier

## Docker

`apps/server/Dockerfile` использует multi-stage build:

- `deps` — установка зависимостей (`npm ci`);
- `builder` — компиляция `@skribbl/shared` и `@skribbl/server` в `dist/`;
- `dev` — финальный образ: запускает скомпилированный сервер (`node apps/server/dist/index.js`).

`docker-compose.yml` поднимает сервисы `server`, `client` и `redis`.

**Порты:**

| Сервис           | Порт   |
| ---------------- | ------ |
| server (HTTP/WS) | `3001` |
| client           | `5173` |
| redis            | `6379` |

**Переменные окружения сервиса `server`:**

| Переменная      | По умолчанию            | Описание                |
| --------------- | ----------------------- | ----------------------- |
| `REDIS_URL`     | `redis://redis:6379`    | URL подключения к Redis |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Origin клиента для CORS |
| `PORT`          | `3001`                  | Порт HTTP/WS сервера    |
| `HOST`          | `0.0.0.0`               | Хост для прослушивания  |

Запуск:

```bash
docker compose up --build
```

Остановка:

```bash
docker compose down
```

## Workspace Packages

- `@skribbl/client` — клиентская часть
- `@skribbl/server` — серверная часть
- `@skribbl/shared` — общие типы и контракты

## Development Standards

- Правила работы с Git: `docs/docs/code-style/git.md`
- Базовые настройки линтинга: `eslint.config.js`
- Базовые настройки форматирования: `.prettierrc.json`
