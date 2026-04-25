# PDMU

A service for creating and publishing medical quizzes from `.txt`, `.pdf`, `.doc`, `.docx`, and `.json` files.

The project accepts a source file with questions, parses the quiz structure locally, optionally reads the answer key from a separate file or resolves answers through OpenAI, and then publishes the final quiz as a public hosted page. Around that core flow, the system includes access codes, Telegram-based administration, issue reports, anti-abuse tooling, and quiz export.

## Features

- Upload quizzes through a web interface.
- Support `.txt`, `.pdf`, `.doc`, `.docx`, and `.json` input files.
- Work in two answer modes:
  - one fixed correct answer index for all questions;
  - a separate answer key file.
- Support an AI mode where the quiz is parsed locally first and then answered through OpenAI.
- Publish hosted quiz pages at `GET /quiz/:slug`.
- Return both a JSON version of the quiz and a ZIP export bundle.
- Restrict quiz creation with access codes and track question usage per code.
- Support one-time, reusable, and refillable access codes.
- Provide a Telegram bot for admin operations, code management, AI settings, bans, and reports.
- Store user issue reports together with uploaded source files and device metadata.
- Track basic anti-abuse data such as devices, browser id, visits, AI bans, and request logs.

## How It Works

### Main flow

1. A user uploads a source file through the frontend in `public/`.
2. `server.js` accepts the file through `multer`.
3. The parser in `src/parser.js` extracts text and tries several strategies to reconstruct quiz questions.
4. The parsed result is stored as a draft in SQLite.
5. After an access code is validated, the draft is finalized into a published quiz.
6. The public quiz page is rendered through `src/quiz-assets.js`.

### AI flow

1. The local parser prepares a normalized list of questions.
2. `src/openai-answering.js` sends those questions to the OpenAI Responses API.
3. The service can run either:
   - a primary model only;
   - or a primary model plus a checker model.
4. The resolved answers, suspicious questions, and raw AI outputs are stored with the quiz data.

## Tech Stack

### Backend

- `Node.js`
- `Express 5`
- `multer` for file uploads
- `archiver` for ZIP export

### Storage

- SQLite through built-in `node:sqlite`
- database file stored at `DATA_DIR/pdmu.sqlite`

### Document parsing

- `pdf-parse` for PDF
- `mammoth` for DOCX
- `word-extractor` for DOC

### AI

- OpenAI Responses API
- default models:
  - `gpt-5.4`
  - `gpt-5.4-mini`

### Export and generation

- `pdfkit`
- `docx`

### Integrations

- `node-telegram-bot-api` for Telegram admin and client code workflows

## Repository Structure

```text
.
├── public/
│   ├── admin.html        # upload UI and AI flow
│   ├── admin.js          # client-side form, AI, and reporting logic
│   └── admin.css         # frontend styles
├── scripts/
│   ├── create-codes.mjs  # CLI access code generator
│   └── smoke-test.mjs    # local smoke test
├── src/
│   ├── db.js             # SQLite schema and data access
│   ├── openai-answering.js
│   ├── parser.js
│   ├── quiz-assets.js    # public quiz HTML/CSS and ZIP bundle
│   ├── telegram-bot.js
│   └── utils.js
├── data/                 # SQLite database and stored files
├── server.js             # HTTP entry point
└── render.yaml           # deployment config
```

## Database

The SQLite database stores:

- `access_codes` — access codes, question limits, client linkage, price, and status.
- `quizzes` — published quizzes.
- `quiz_drafts` — intermediate parsing results before publication.
- `quiz_devices` — visit and device tracking.
- `quiz_reports` — reports for already published quizzes.
- `upload_reports` — reports for parsing or upload issues before publication.
- `app_settings` — site-wide and AI settings.
- `payment_sessions` — access code refill sessions.
- `ai_request_logs` — AI request history.
- `ai_device_bans` — blocked browser ids.

## Web Interface

The main page is available at `/` and opens the quiz creation form.

The frontend already supports:

- course selection;
- quiz title input;
- source file upload;
- answer option count selection;
- switching between fixed-answer mode and answer-key-file mode;
- question count selection;
- AI preparation flow;
- reporting an issue with the current upload.

## API

### Public routes

- `GET /` — quiz creation page.
- `GET /health` — healthcheck and basic runtime configuration.
- `GET /api/site-notice` — current homepage notice.
- `POST /api/parse` — parse an uploaded file into a draft.
- `POST /api/ai-quizzes/inspect` — inspect a file locally before AI processing.
- `POST /api/ai-quizzes/prepare` — start AI preparation.
- `GET /api/ai-quizzes/jobs/:jobId` — get AI job status.
- `POST /api/access-codes/check` — validate an access code.
- `POST /api/quizzes/finalize` — publish a draft as a final quiz.
- `GET /api/quizzes/:slug` — JSON representation of a published quiz.
- `GET /quiz/:slug` — public hosted HTML quiz page.
- `POST /api/quizzes/:slug/report` — submit a report for a published quiz.
- `POST /api/reports/upload` — report a parsing/upload problem with attached files.
- `GET /api/download/:slug` — download the quiz as a ZIP bundle.

### Admin routes

All admin routes are protected with the `X-Admin-Secret` header.

- `POST /api/admin/codes` — create access codes.
- `GET /api/admin/quizzes/:id` — get quiz details for admin use.
- `GET /api/admin/reports` — list reports.
- `GET /api/admin/reports/:id` — get a single report.
- `GET /api/admin/reports/:id/files/:kind` — download a file attached to a report.
- `POST /api/admin/quizzes/:slug/ban` — ban or unban a quiz.
- `DELETE /api/admin/quizzes/:id` — delete a quiz.

## Telegram Bot

The Telegram bot runs in the same process and uses the same SQLite database as the web service.

It can be used to:

- issue access codes;
- create reusable codes;
- top up existing codes;
- inspect code status;
- check database and accounting info;
- manage the homepage notice;
- switch AI modes and limits;
- inspect AI logs and AI bans;
- search and moderate hosted quizzes;
- inspect and delete reports;
- manage client code and refill flows.

To enable it, configure:

- `TELEGRAM_BOT_ENABLED=1`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_USER_ID`

## Environment Variables

Minimum setup for local development:

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

AI configuration:

```env
OPENAI_API_KEY=replace-me
OPENAI_PRIMARY_MODEL=gpt-5.4
OPENAI_CHECK_MODEL=gpt-5.4-mini
OPENAI_CHUNK_SIZE=180
USE_MOCK_AI=0
```

Telegram configuration:

```env
TELEGRAM_BOT_ENABLED=0
TELEGRAM_BOT_TOKEN=replace-me
TELEGRAM_ADMIN_USER_ID=123456789
ADMIN_CONTACT_TG=@your_username
```

The project also uses additional environment variables for payment flows, AI runtime behavior, cooldowns, limits, and internal service settings. The best source of truth for those is currently the code in `server.js`, `src/db.js`, and `src/telegram-bot.js`.

## Local Development

```bash
npm install
```

Create `.env` from `.env.example`, then run:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Scripts

```bash
npm run dev
npm start
npm run codes:create -- 5
npm run smoke:test
npm run smoke:test -- .docx
```

What they do:

- `npm run dev` — run the server with `node --watch`.
- `npm start` — start the server normally.
- `npm run codes:create -- 5` — create 5 access codes through the CLI.
- `npm run smoke:test` — start the app locally and run a smoke test against a sample PDF.
- `npm run smoke:test -- .docx` — run the same smoke test against a DOCX file.

## Typical Usage Scenarios

### Local parsing without AI

1. The admin creates an access code.
2. A user opens the main page.
3. The user uploads a question file.
4. The user selects the answer mode.
5. The service creates a draft.
6. After code validation, the draft is published under a unique `slug`.

### AI-assisted quiz generation

1. A user uploads a file and starts AI inspection.
2. The local parser extracts the questions.
3. OpenAI returns answer indexes.
4. In double-pass mode, the service compares primary and checker outputs.
5. Suspicious questions are flagged for review.
6. The final quiz is published in the same way as a regular quiz.

## Implementation Notes

- The parser is not tied to a single document template and tries multiple extraction strategies.
- DOCX files have extra heuristics because line breaks and structure are often the least stable there.
- The AI flow includes question chunking, schema-constrained responses, and retries when the response hits `max_output_tokens`.
- Draft storage exists as a separate layer, so publication is decoupled from parsing.
- The project already includes device tracking, browser id capture, and report handling, which helps with moderation and anti-abuse workflows.

## Deployment

The repository includes a `render.yaml`, but for real usage the project is better suited to hosting with persistent storage, because both SQLite and uploaded files need to survive restarts.

In practice, that means:

- Render can work for demos;
- Railway, a VPS, or any host with persistent disk is a better fit for continuous use.

## Limitations

- SQLite is a good fit for a small or medium project, but not for heavy horizontal scaling.
- Parsing quality still depends on the structure and quality of the source documents.
- AI mode requires a valid `OPENAI_API_KEY`.
- Some interface and response strings in the codebase are still mixed across Ukrainian, Russian, and English.
- A lot of business logic currently lives in `server.js` and `src/telegram-bot.js`, so splitting those modules further would help as the project grows.

## Good Next Steps

- Move admin API logic into dedicated routers.
- Add full integration tests beyond the current smoke test.
- Build a proper web admin panel instead of Telegram-only admin tooling.
- Add a question editor before publication.
- Normalize all user-facing copy into one language.

## License

`package.json` currently declares the project as `ISC`.
