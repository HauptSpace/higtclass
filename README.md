# Zifra

Таблицы без мучений с Excel — для всех, от ларька до CEO. Колонки с типами вместо ручного
форматирования, итоги считаются сами, запись голосом, текстом или по фото чека через ИИ,
5 языков (ru, uk, en, de, es). Сайт сейчас, `.exe` для Windows — следующим шагом.

- [Почему людям не нравятся Excel, Google Sheets и Notion](docs/research.md)
- [Архитектура](docs/architecture.md)

## Запуск на своём компьютере

Нужно: [Node.js 22.13 или новее](https://nodejs.org) (лучше 24 LTS) и pnpm
(`corepack enable` включает его, он идёт вместе с Node).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # Windows: copy apps\api\.env.example apps\api\.env
pnpm dev                                 # сайт на http://localhost:5173, API на :8787
```

В `apps/api/.env` впишите `ANTHROPIC_API_KEY` (ключ с console.anthropic.com). Без ключа
всё работает, кроме ИИ: короткие записи вроде «кава 85» Zifra понимает и без него.
Аккаунты и общие таблицы хранятся в файле `apps/api/zifra.db` (путь — `ZIFRA_DB`).

Для работы с Claude Code: откройте папку проекта и запустите `claude` — гайд для
него лежит в [CLAUDE.md](CLAUDE.md).

```bash
pnpm test        # тесты ядра и API
pnpm typecheck
pnpm build       # сборка сайта в apps/web/dist
```

## Структура

- `packages/core` — модель данных, разбор ввода на 5 языках, формулы, операции с отменой, итоги, шаблоны.
- `apps/web` — интерфейс (React + Vite). Данные хранятся на устройстве (IndexedDB), работают без интернета
  и синхронизируются с сервером после входа.
- `apps/api` — сервер: ИИ-помощник (Claude), аккаунты, общие таблицы и команда, курсы валют.
  Ключ ИИ хранится только здесь, в браузер не попадает.
- `scripts/i18n-add.py` — добавить тексты сразу на 5 языках.
