# higtclass

Таблицы без мучений: типы колонок вместо ручного форматирования, итоги считаются сами,
форма «Записать» в одно касание, 5 языков (ru, uk, en, de, es). Скоро — ИИ-помощник
(диктовка, фото чека) и `.exe` для Windows.

- [Почему людям не нравятся Excel, Google Sheets и Notion](docs/research.md)
- [Архитектура](docs/architecture.md)

## Запуск

```bash
pnpm install
pnpm dev        # сайт на http://localhost:5173
pnpm test       # тесты ядра
pnpm typecheck
pnpm build
```

## Структура

- `packages/core` — модель данных, разбор ввода на 5 языках, формулы, операции с отменой, итоги, шаблоны.
- `apps/web` — интерфейс (React + Vite). Данные хранятся на устройстве (IndexedDB) и работают без интернета.
