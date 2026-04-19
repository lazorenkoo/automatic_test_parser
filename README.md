# PDMU Quiz Service

Сервис принимает файл с тестами (`.pdf`, `.doc`, `.docx`), парсит вопросы локально, применяет указанный номер правильного ответа ко всем вопросам и выдает:

- публичную ссылку на готовый тест;
- `zip`-экспорт в формате статического мини-сайта;
- JSON-данные теста через API.

## Что уже умеет

- локально читать `.pdf`, `.doc`, `.docx` без OpenAI API;
- учитывать заданное количество вариантов ответа в каждом вопросе;
- ограничивать количество извлекаемых вопросов;
- использовать одноразовые коды с защитой от повторного использования;
- хранить готовые тесты в SQLite;
- отдавать готовый тест по ссылке `/quiz/:slug`;
- генерировать `zip`-архив по формату вашего шаблона;
- создавать новые одноразовые коды через admin API и CLI.

## Стек

- Node.js + Express
- SQLite (`better-sqlite3`)
- Локальный парсер файлов:
  - `pdf-parse` для PDF
  - `mammoth` для DOCX
  - `word-extractor` для DOC
- Чистый HTML/CSS/JS без фронтенд-сборки

## Запуск локально

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
- `BASE_URL` - базовый URL для ссылок в ответе API
- `DATA_DIR` - папка для SQLite базы
- `ADMIN_SECRET` - секрет для admin API генерации кодов
- `MAX_UPLOAD_MB` - максимальный размер загружаемого файла
- `CODE_RESERVATION_MINUTES` - сколько минут держать код зарезервированным на время обработки

## Генерация кодов

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

## Как протестировать

Быстрый smoke test на локальном парсере:

```bash
npm run smoke:test
npm run smoke:test -- .docx
```

Скрипт сам:

1. поднимет локальный сервер;
2. создаст код;
3. сгенерирует тестовый `.pdf` или `.docx`;
4. отправит файл в сервис;
5. проверит публичную страницу, JSON и `zip`.

## Хостинг

Для постоянной работы проще всего Railway с persistent volume под SQLite.

Бесплатный Render Free годится только как демо:

- web service засыпает после 15 минут простоя;
- локальная файловая система эфемерная;
- free Postgres на Render истекает через 30 дней.
