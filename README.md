# 🏰 Disney Paris Planner — Telegram Mini App

Планировщик визита в Disneyland Paris. Работает как Telegram Mini App и как обычный сайт.

## Быстрый старт

### 1. Создай бота
- Открой @BotFather в Telegram
- `/newbot` → дай имя → получи токен

### 2. Деплой на Railway
1. Запушь эти файлы в GitHub-репо
2. [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Добавь переменные окружения (Variables):
   - `TELEGRAM_BOT_TOKEN` = токен от BotFather
   - `APP_URL` = URL вашего Railway-деплоя (напр. `https://disney-planner-production.up.railway.app`)
4. Settings → Networking → Generate Domain
5. Скопируй URL → вставь в `APP_URL`
6. Railway автоматически передеплоит

### 3. Настрой Mini App в BotFather
- `/mybots` → выбери бота → Bot Settings → Menu Button
- Задай URL = твой Railway URL

### 4. Готово!
Открой бота → `/start` → нажми кнопку "Открыть планировщик"

## Команды бота
- `/start` — кнопка с Mini App
- `/wait` — текущие очереди текстом
- `/help` — справка

## Структура
```
├── server.js           # Express + Telegram bot + Queue-Times proxy
├── public/index.html   # Mini App (mobile-first UI)
├── Dockerfile
└── package.json
```

## Данные

**Live** — Queue-Times API через прокси `/api/queue/:id`, обновление каждые 5 мин

**Исторические средние** — захардкожены (средние пиковые значения и лучшие часы на основе данных queue-times.com за 2014–2025)

Индикатор в UI показывает какие данные активны: 🟢 Live или 🟡 Средние

## Powered by [Queue-Times.com](https://queue-times.com/)
