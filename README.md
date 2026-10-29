# Zifra

Таблицы без мучений с Excel — для всех, от ларька до CEO. Колонки с типами вместо ручного
форматирования, итоги считаются сами, запись голосом, текстом или по фото чека через ИИ,
5 языков (ru, uk, en, de, es). Сайт сейчас, `.exe` для Windows — следующим шагом.

- [Почему людям не нравятся Excel, Google Sheets и Notion](docs/research.md)
- [Архитектура](docs/architecture.md)

## Запуск

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # и впишите ANTHROPIC_API_KEY
pnpm dev                                 # сайт на http://localhost:5173, API на :8787
```

Без ключа всё работает, кроме ИИ-строки: она покажет, что помощник не подключён.

```bash
pnpm test        # тесты ядра и API
pnpm typecheck
pnpm build       # сборка сайта в apps/web/dist
```

## Структура

- `packages/core` — модель данных, разбор ввода на 5 языках, формулы, операции с отменой, итоги, шаблоны.
- `apps/web` — интерфейс (React + Vite). Данные хранятся на устройстве (IndexedDB) и работают без интернета.
- `apps/api` — сервер ИИ-помощника (Claude). Ключ хранится только здесь, в браузер не попадает.
