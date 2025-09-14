# Telegram Dice Bot 🎲

Telegram бот на Node.js с TypeScript, который умеет бросать кубики с помощью эмодзи.

## Функции

- `/start` - начать работу с ботом
- `/dice` - бросить кубик (1-6)
- `/help` - показать справку

## Установка и запуск

### Локальный запуск

1. Установите зависимости:
```bash
pnpm install
```

2. Соберите проект:
```bash
pnpm run build
```

3. Запустите бота:
```bash
pnpm start
```

Или для разработки:
```bash
pnpm run dev
```

### Запуск в Docker

1. Соберите Docker образ:
```bash
docker build -t telegram-dice-bot .
```

2. Запустите контейнер:
```bash
docker run -d --name dice-bot --env-file .env telegram-dice-bot
```

## Переменные окружения

- `TELEGRAM_BOT_TOKEN` - токен вашего Telegram бота

## Структура проекта

```
├── src/
│   └── index.ts          # Основной файл бота
├── dist/                 # Скомпилированные файлы
├── .env                  # Переменные окружения
├── package.json          # Зависимости проекта
├── tsconfig.json         # Конфигурация TypeScript
├── Dockerfile            # Docker конфигурация
└── README.md            # Документация
```
