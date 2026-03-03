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

## Workspace Packages

- `@skribbl/client` — клиентская часть
- `@skribbl/server` — серверная часть
- `@skribbl/shared` — общие типы и контракты

## Development Standards

- Правила работы с Git: `docs/docs/code-style/git.md`
- Базовые настройки линтинга: `eslint.config.js`
- Базовые настройки форматирования: `.prettierrc.json`
