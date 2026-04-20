import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import archiver from 'archiver';
import {
  createAccessCodes,
  createQuizDraft,
  deleteQuizById,
  finalizeQuizFromDraftReservation,
  getDbMeta,
  getQuizBySlug,
  recordQuizVisit,
  releaseReservation,
  reserveAccessCode,
  setQuizBanStatus,
} from './src/db.js';
import {
  parseAnswerKeyFromFile,
  parseQuizFromFile,
  SUPPORTED_ANSWER_EXTENSIONS,
  SUPPORTED_UPLOAD_EXTENSIONS,
} from './src/parser.js';
import { startTelegramBot } from './src/telegram-bot.js';
import { buildZipBundle, renderHostedQuizHtml } from './src/quiz-assets.js';
import {
  buildAbsoluteUrl,
  htmlEscape,
  normalizeUploadedFilename,
  randomToken,
  sanitizeText,
} from './src/utils.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const maxUploadBytes = Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxUploadBytes,
  },
});

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.resolve('public')));

app.get('/', (_req, res) => {
  res.sendFile(path.resolve('public/admin.html'));
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    dbPath: getDbMeta().dbPath,
    parser: 'local-v2',
    supportedFileTypes: SUPPORTED_UPLOAD_EXTENSIONS,
    supportedAnswerFileTypes: SUPPORTED_ANSWER_EXTENSIONS,
  });
});

app.post('/api/parse', upload.fields([
  { name: 'sourceFile', maxCount: 1 },
  { name: 'answerFile', maxCount: 1 },
  { name: 'pdf', maxCount: 1 },
]), async (req, res, next) => {
  const sourceFile = req.files?.sourceFile?.[0] || req.files?.pdf?.[0] || null;
  const answerFile = req.files?.answerFile?.[0] || null;
  const answerMode = String(req.body.answerMode || 'single');
  const answerIndex = Number(req.body.answerIndex);
  const optionCount = Number(req.body.optionCount);
  const questionMode = String(req.body.questionMode || 'manual');
  const questionLimit = questionMode === 'all' ? null : Number(req.body.questionLimit);
  const originalFilename = normalizeUploadedFilename(sourceFile?.originalname || '');
  const sourceExtension = path.extname(originalFilename).toLowerCase();

  if (!sourceFile) {
    return res.status(400).json({ error: 'Нужно загрузить файл с тестами.' });
  }

  if (!SUPPORTED_UPLOAD_EXTENSIONS.includes(sourceExtension)) {
    return res.status(400).json({
      error: `Поддерживаются только файлы ${SUPPORTED_UPLOAD_EXTENSIONS.join(', ')}.`,
    });
  }

  if (!Number.isInteger(optionCount) || optionCount < 2 || optionCount > 10) {
    return res.status(400).json({ error: 'Количество вариантов ответа должно быть от 2 до 10.' });
  }

  if (!['single', 'file'].includes(answerMode)) {
    return res.status(400).json({ error: 'Неверный режим ответов.' });
  }

  if (answerMode === 'single' && (!Number.isInteger(answerIndex) || answerIndex < 1 || answerIndex > optionCount)) {
    return res.status(400).json({ error: `Правильный вариант должен быть от 1 до ${optionCount}.` });
  }

  if (answerMode === 'file') {
    if (!answerFile) {
      return res.status(400).json({ error: 'Нужно загрузить отдельный файл с ответами.' });
    }

    const answerFilename = normalizeUploadedFilename(answerFile.originalname || '');
    const answerExtension = path.extname(answerFilename).toLowerCase();
    if (!SUPPORTED_ANSWER_EXTENSIONS.includes(answerExtension)) {
      return res.status(400).json({
        error: `Поддерживаются только файлы ответов ${SUPPORTED_ANSWER_EXTENSIONS.join(', ')}.`,
      });
    }
  }

  if (questionMode !== 'all' && (!Number.isInteger(questionLimit) || questionLimit < 1)) {
    return res.status(400).json({ error: 'Количество вопросов должно быть больше 0.' });
  }

  try {
    const parsedAnswerKey = answerMode === 'file'
      ? await parseAnswerKeyFromFile({
        buffer: answerFile.buffer,
        filename: normalizeUploadedFilename(answerFile.originalname || ''),
      })
      : null;

    const parsedQuiz = await parseQuizFromFile({
      buffer: sourceFile.buffer,
      filename: originalFilename,
      answerIndex: answerMode === 'single' ? answerIndex : 1,
      limit: questionMode === 'all' ? null : questionLimit,
      optionCount,
      answerKey: parsedAnswerKey,
    });

    const requestedCount = questionMode === 'all'
      ? parsedQuiz.questions.length
      : questionLimit;

    const draft = createQuizDraft({
      title: sanitizeText(parsedQuiz.title) || 'Medical quiz',
      sourceFilename: originalFilename,
      answerIndex: answerMode === 'single' ? answerIndex : 0,
      requestedCount,
      questions: parsedQuiz.questions,
      reviewBlocks: parsedQuiz.reviewBlocks,
      rawModelJson: parsedQuiz.rawModelJson,
    });

    return res.status(201).json({
      draftToken: draft.draftToken,
      title: sanitizeText(parsedQuiz.title) || 'Medical quiz',
      parsedCount: parsedQuiz.questions.length,
      requestedCount,
      questionMode,
      answerMode,
      notes: parsedQuiz.notes,
      adminContactTg: normalizePublicUsername(process.env.ADMIN_CONTACT_TG || process.env.PUBLIC_ADMIN_TG || ''),
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/quizzes/finalize', async (req, res, next) => {
  const accessCode = String(req.body.accessCode || '');
  const draftToken = String(req.body.draftToken || '');

  if (!draftToken) {
    return res.status(400).json({ error: 'Нет черновика. Сначала передайте файл заново.' });
  }

  const reservation = reserveAccessCode(accessCode);
  if (!reservation) {
    return res.status(403).json({ error: 'Код недействителен, уже использован или сейчас обрабатывается.' });
  }

  try {
    const savedQuiz = finalizeQuizFromDraftReservation({
      reservationToken: reservation.reservationToken,
      draftToken,
    });

    const quiz = getQuizBySlug(savedQuiz.slug);
    return res.status(201).json({
      slug: savedQuiz.slug,
      title: quiz.title,
      parsedCount: quiz.parsedCount,
      quizUrl: buildAbsoluteUrl(req, `/quiz/${savedQuiz.slug}`),
      downloadUrl: buildAbsoluteUrl(req, `/api/download/${savedQuiz.slug}`),
      apiUrl: buildAbsoluteUrl(req, `/api/quizzes/${savedQuiz.slug}`),
      siteType: savedQuiz.siteType,
      siteTypeLabel: formatSiteType(savedQuiz.siteType),
      warningDeviceLimit: getDeviceWarningLimit(savedQuiz.siteType),
      clientTgUsername: savedQuiz.clientTgUsername,
      expectedQuestionCount: savedQuiz.expectedQuestionCount,
    });
  } catch (error) {
    releaseReservation(reservation.reservationToken);
    return next(error);
  }
});

app.get('/api/quizzes/:slug', (req, res) => {
  const quiz = getQuizBySlug(req.params.slug);
  if (!quiz) {
    return res.status(404).json({ error: 'Тест не найден.' });
  }

  if (quiz.bannedAt) {
    return res.status(410).json({ error: 'Тест заблокирован администратором.' });
  }

  return res.json({
    slug: quiz.slug,
    title: quiz.title,
    sourceFilename: quiz.sourceFilename,
    answerIndex: quiz.answerIndex,
    requestedCount: quiz.requestedCount,
    parsedCount: quiz.parsedCount,
    createdAt: quiz.createdAt,
    questions: quiz.questions,
    siteType: quiz.siteType,
    siteTypeLabel: formatSiteType(quiz.siteType),
    clientTgUsername: quiz.clientTgUsername,
  });
});

app.get('/quiz/:slug', (req, res) => {
  const quiz = getQuizBySlug(req.params.slug);
  if (!quiz) {
    return res.status(404).type('text/plain').send('Quiz not found');
  }

  if (quiz.bannedAt) {
    return res.status(410).type('html').send(renderUnavailableQuizHtml(quiz.title));
  }

  let deviceId = getCookieValue(req, 'pdmu_device_id');
  if (!deviceId) {
    deviceId = randomToken();
    setDeviceCookie(res, deviceId);
  }

  recordQuizVisit({
    quizId: quiz.id,
    deviceId,
    ip: getClientIp(req),
    userAgent: req.get('user-agent'),
  });

  res.type('html').send(renderHostedQuizHtml(quiz, buildAbsoluteUrl(req, `/quiz/${quiz.slug}`)));
});

app.get('/api/download/:slug', (req, res) => {
  const quiz = getQuizBySlug(req.params.slug);
  if (!quiz) {
    return res.status(404).json({ error: 'Тест не найден.' });
  }

  if (quiz.bannedAt) {
    return res.status(410).json({ error: 'Тест заблокирован администратором.' });
  }

  const bundle = buildZipBundle(quiz);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${bundle.folder}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (error) => {
    res.destroy(error);
  });

  archive.pipe(res);
  bundle.files.forEach((file) => {
    archive.append(file.content, { name: file.name });
  });
  archive.finalize();
});

app.post('/api/admin/codes', requireAdminSecret, (req, res) => {
  const count = Number(req.body.count || 1);
  const label = req.body.label ? String(req.body.label) : null;
  const metadata = {
    siteType: req.body.siteType,
    clientTgUsername: req.body.clientTgUsername,
    expectedQuestionCount: req.body.expectedQuestionCount,
    price: req.body.price,
  };
  const codes = createAccessCodes(count, label, metadata);

  return res.status(201).json({ codes });
});

app.post('/api/admin/quizzes/:slug/ban', requireAdminSecret, (req, res) => {
  const banned = req.body?.banned !== false;
  const quiz = setQuizBanStatus(req.params.slug, banned);

  if (!quiz) {
    return res.status(404).json({ error: 'Тест не найден.' });
  }

  return res.json({
    slug: quiz.slug,
    bannedAt: quiz.bannedAt,
  });
});

app.delete('/api/admin/quizzes/:id', requireAdminSecret, (req, res) => {
  const quiz = deleteQuizById(req.params.id);
  if (!quiz) {
    return res.status(404).json({ error: 'Тест не найден.' });
  }

  return res.json({
    id: quiz.id,
    slug: quiz.slug,
    title: quiz.title,
  });
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: `Файл слишком большой. Максимум ${Number(process.env.MAX_UPLOAD_MB || 20)} MB.`,
    });
  }

  const statusCode = Number(error?.statusCode || 500);
  const message = error?.message || 'Внутренняя ошибка сервера.';
  return res.status(statusCode).json({ error: message });
});

app.listen(port, () => {
  console.log(`PDMU Quiz Service listening on http://localhost:${port}`);
  console.log(`SQLite: ${getDbMeta().dbPath}`);
  startTelegramBot();
});

function requireAdminSecret(req, res, next) {
  const headerSecret = String(req.get('X-Admin-Secret') || '');
  const expectedSecret = String(process.env.ADMIN_SECRET || '');

  if (!expectedSecret || headerSecret !== expectedSecret) {
    return res.status(403).json({ error: 'Неверный admin secret.' });
  }

  return next();
}

function getCookieValue(req, key) {
  const cookieHeader = String(req.get('cookie') || '');
  if (!cookieHeader) {
    return '';
  }

  const cookies = cookieHeader.split(';');
  for (const entry of cookies) {
    const [rawName, ...rest] = entry.split('=');
    if (String(rawName || '').trim() !== key) {
      continue;
    }

    return decodeURIComponent(rest.join('=').trim());
  }

  return '';
}

function setDeviceCookie(res, deviceId) {
  const maxAge = 60 * 60 * 24 * 365;
  res.append('Set-Cookie', [
    `pdmu_device_id=${encodeURIComponent(deviceId)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
  ].join('; '));
}

function getClientIp(req) {
  const forwardedFor = String(req.get('x-forwarded-for') || '').split(',')[0].trim();
  return forwardedFor || req.ip || '';
}

function renderUnavailableQuizHtml(title) {
  const safeTitle = htmlEscape(sanitizeText(title) || 'Тест');
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:"Outfit","Segoe UI",sans-serif;background:linear-gradient(160deg,#f8f4ee 0%,#f3ede2 100%);color:#1f2937}
    .card{max-width:560px;margin:20px;padding:28px;border-radius:24px;background:#fffdf8;border:1px solid #eadfcf;box-shadow:0 18px 48px rgba(31,41,55,.08)}
    h1{margin:0 0 12px;font-size:32px}
    p{margin:0;color:#6b7280;font-size:18px;line-height:1.5}
  </style>
</head>
<body>
  <section class="card">
    <h1>Тест недоступен</h1>
    <p>Этот тест был отключен администратором.</p>
  </section>
</body>
</html>`;
}

function normalizePublicUsername(value) {
  const normalized = String(value || '').trim().replace(/^@+/, '');
  return normalized ? `@${normalized}` : '';
}

function formatSiteType(siteType) {
  return String(siteType || '') === '2' ? 'Групповой' : 'Одиночный';
}

function getDeviceWarningLimit(siteType) {
  return String(siteType || '') === '2' ? 20 : 2;
}
