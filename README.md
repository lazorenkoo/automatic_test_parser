# PDMU

Service for creating and publishing medical quizzes from `.txt`, `.pdf`, `.doc`, `.docx`, and `.json` files.

## What it does

- Uploads and parses quiz files.
- Supports two answer modes:
  - one fixed correct option for all questions;
  - separate answer key file.
- Supports AI answer resolution through OpenAI.
- Publishes hosted quizzes at `/quiz/:slug`.
- Returns quiz JSON and ZIP export.
- Restricts quiz creation with access codes.
- Supports reusable and refillable codes.
- Includes Telegram bot admin tools.
- Stores reports, uploaded source files, device data, and AI logs.

## Stack

- `Node.js`
- `Express 5`
- SQLite via `node:sqlite`
- `multer` for uploads
- `pdf-parse`, `mammoth`, `word-extractor` for parsing
- OpenAI Responses API
- `node-telegram-bot-api`

## Project structure

```text
public/     frontend
scripts/    CLI + smoke tests
src/        parser, db, AI, telegram bot, quiz rendering
server.js   HTTP entry point
data/       SQLite + stored files
```

## Main flow

1. User uploads a source file.
2. The app parses questions locally.
3. Parsed data is stored as a draft in SQLite.
4. Access code is checked.
5. Draft is finalized into a published quiz.
6. Quiz becomes available at `/quiz/:slug`.

## AI mode

- The file is parsed locally first.
- Questions are sent to OpenAI.
- The app can use:
  - primary model only;
  - or primary model + checker model.
- Resolved answers and suspicious questions are saved with the quiz.

## Telegram bot

The bot runs in the same process and uses the same SQLite database.

Admin side:

- create codes;
- create reusable codes;
- top up codes;
- inspect codes;
- manage AI settings;
- list active AI codes and their owners;
- ban/unban quizzes or AI devices;
- inspect reports;
- view accounting info.

Client side:

- `/createcode` — request a code;
- `/mycodes` — show personal codes;
- `/topup` — top up an existing code.

## Telegram payment / code top-up flow

The bot supports paid code top-ups through Telegram chat flow.

How it works:

1. Client sends `/topup`.
2. Bot asks for the target code.
3. Bot asks how many questions to add.
4. Price is calculated from `TELEGRAM_QUESTION_PRICE_MINOR`.
5. A `payment_sessions` record is created in SQLite.
6. Bot sends payment details:
   - `TELEGRAM_PAYMENT_TOPUP_LINK` or `MONOBANK_TOPUP_LINK` for large payments;
   - otherwise `TELEGRAM_PAYMENT_CARD_NUMBER` or `MONOBANK_TOPUP_CARD`.
7. Client presses `I paid`.
8. The bot tries to match the payment, including Monobank-based matching when configured.
9. If payment is confirmed, the code balance is increased.

Related payment settings:

- `TELEGRAM_QUESTION_PRICE_MINOR`
- `TELEGRAM_PAYMENT_COOLDOWN_MS`
- `TELEGRAM_PAYMENT_SESSION_MS`
- `TELEGRAM_PAYMENT_CARD_NUMBER`
- `TELEGRAM_PAYMENT_CARD_LABEL`
- `TELEGRAM_PAYMENT_TOPUP_LINK`
- `MONOBANK_TOPUP_CARD`
- `MONOBANK_TOPUP_LINK`
- `MONOBANK_PERSONAL_TOKEN`
- `MONOBANK_PERSONAL_ACCOUNT`

## API

Public:

- `GET /`
- `GET /health`
- `GET /api/site-notice`
- `POST /api/parse`
- `POST /api/ai-quizzes/inspect`
- `POST /api/ai-quizzes/prepare`
- `GET /api/ai-quizzes/jobs/:jobId`
- `POST /api/access-codes/check`
- `POST /api/quizzes/finalize`
- `GET /api/quizzes/:slug`
- `GET /quiz/:slug`
- `POST /api/quizzes/:slug/report`
- `POST /api/reports/upload`
- `GET /api/download/:slug`

Admin:

- `POST /api/admin/codes`
- `GET /api/admin/quizzes/:id`
- `GET /api/admin/reports`
- `GET /api/admin/reports/:id`
- `GET /api/admin/reports/:id/files/:kind`
- `POST /api/admin/quizzes/:slug/ban`
- `DELETE /api/admin/quizzes/:id`

Admin routes require `X-Admin-Secret`.

## Environment

Minimum:

```env
PORT=3000
BASE_URL=http://localhost:3000
DATA_DIR=./data
ADMIN_SECRET=replace-me
MAX_UPLOAD_MB=20
CODE_RESERVATION_MINUTES=15
QUIZ_PUBLIC_TTL_DAYS=7
TELEGRAM_BOT_ENABLED=0
```

AI:

```env
OPENAI_API_KEY=replace-me
OPENAI_PRIMARY_MODEL=gpt-5.4
OPENAI_CHECK_MODEL=gpt-5.4-mini
OPENAI_CHUNK_SIZE=180
PUTER_PARSER_REPAIR_ENABLED=1
PUTER_PARSER_REPAIR_MODEL=google/gemini-2.5-flash-lite
PUTER_PARSER_REPAIR_BATCH_SIZE=20
USE_MOCK_AI=0
```

Telegram:

```env
TELEGRAM_BOT_ENABLED=1
TELEGRAM_BOT_TOKEN=replace-me
TELEGRAM_ADMIN_USER_ID=123456789
ADMIN_CONTACT_TG=@your_username
```

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Scripts

```bash
npm run dev
npm start
npm run codes:create -- 5
npm run smoke:test
npm run smoke:test -- .docx
```

## Notes

- SQLite is fine for a small or medium deployment.
- Persistent storage is required for real usage.
- `render.yaml` exists, but Railway or any host with persistent disk is a better fit.

## License

`ISC`
