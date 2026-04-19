# PDMU Quiz Service

Сервис принимает файл с тестами (`.pdf`, `.doc`, `.docx`), парсит вопросы локально, применяет выбранный номер правильного ответа ко всем вопросам и выдает публичную ссылку на готовый тест.

## Что умеет

- принимать `.pdf`, `.doc`, `.docx`;
- учитывать выбранное количество вариантов ответа в каждом вопросе;
- ограничивать, сколько вопросов брать из файла;
- использовать одноразовые коды доступа;
- хранить коды и тесты в одной SQLite базе;
- отдавать готовый тест по ссылке `/quiz/:slug`;
- генерировать коды через CLI, API и Telegram-бота.

## Стек

- Node.js + Express
- SQLite (`better-sqlite3`)
- `pdf-parse` для PDF
- `mammoth` для DOCX
- `word-extractor` для DOC
- `node-telegram-bot-api` для личного бота

## Локальный запуск

```bash
npm install
```

Создайте `.env` на основе `.env.example`, затем:

```bash
npm run dev
```

Откройте:

```text
http://localhost:3000
```

## Переменные окружения

- `PORT` - порт приложения
- `BASE_URL` - базовый URL для ссылок
- `DATA_DIR` - папка для SQLite базы
- `ADMIN_SECRET` - секрет для admin API
- `MAX_UPLOAD_MB` - максимальный размер файла
- `CODE_RESERVATION_MINUTES` - сколько держать код зарезервированным на время обработки
- `TELEGRAM_BOT_ENABLED` - `1`, чтобы включить Telegram-бота
- `TELEGRAM_BOT_TOKEN` - токен бота из BotFather
- `TELEGRAM_ADMIN_USER_ID` - ваш Telegram user id

## Telegram-бот

Бот работает в этом же Node-процессе и использует ту же SQLite базу, что и сайт. Никакой отдельной синхронизации не нужно: код, созданный ботом, сразу можно вводить на сайте.

### Как включить

1. Создайте бота через `@BotFather`.
2. Возьмите токен.
3. Напишите боту в Telegram.
4. Временно запустите проект и отправьте боту `/id`.
5. Скопируйте `user id`.
6. Пропишите в `.env`:

```env
TELEGRAM_BOT_ENABLED=1
TELEGRAM_BOT_TOKEN=ваш_токен
TELEGRAM_ADMIN_USER_ID=ваш_user_id
```

7. Перезапустите сервер.

После этого бот будет принимать команды только от вашего Telegram ID и только в личном чате.

### Команды бота

- `/id` - показать ваш Telegram ID
- `/code` - создать 1 код
- `/code my-label` - создать 1 код с label
- `/codes 5` - создать 5 кодов
- `/codes 5 my-batch` - создать 5 кодов с label
- `/db` - показать путь к SQLite базе
- `/help` - показать помощь

## Генерация кодов без Telegram

CLI:

```bash
npm run codes:create -- 5
```

Admin API:

```http
POST /api/admin/codes
X-Admin-Secret: your-secret
Content-Type: application/json

{
  "count": 5,
  "label": "tg-bot-batch"
}
```

## Основные роуты

- `GET /` - веб-интерфейс загрузки файла
- `POST /api/quizzes` - создать quiz из `.pdf`, `.doc` или `.docx`
- `GET /quiz/:slug` - публичная страница теста
- `GET /api/quizzes/:slug` - JSON теста
- `GET /api/download/:slug` - `zip`-экспорт
- `POST /api/admin/codes` - создать одноразовые коды
- `GET /health` - healthcheck

## Тестирование

```bash
npm run smoke:test
npm run smoke:test -- .docx
```

## Хостинг

Для постоянной работы проще всего Railway с persistent volume под SQLite.

Для бесплатной демо-версии можно использовать Render Free, но для постоянного использования он неудобен: сервис засыпает, а файловая система без persistent disk не подходит для SQLite.
