import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import archiver from 'archiver';
import {
  createUploadReport,
  createQuizReport,
  createAccessCodes,
  createQuizDraft,
  deleteQuizById,
  finalizeQuizFromDraftReservation,
  getDbMeta,
  inspectAccessCode,
  inspectQuizDraft,
  getQuizById,
  getQuizReportById,
  getUploadReportById,
  getQuizBySlug,
  listQuizReports,
  listUploadReports,
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
import { solveQuizAnswersWithAI } from './src/openai-answering.js';
import { startTelegramBot } from './src/telegram-bot.js';
import { buildZipBundle, renderHostedQuizHtml } from './src/quiz-assets.js';
import {
  buildAbsoluteUrl,
  hashValue,
  htmlEscape,
  normalizeUploadedFilename,
  randomToken,
  sanitizeText,
} from './src/utils.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const maxUploadBytes = Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024;
const uploadsDir = path.join(getDbMeta().dataDir, 'reported-source-files');

fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxUploadBytes,
  },
});

app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader(
    'Accept-CH',
    'Sec-CH-UA, Sec-CH-UA-Mobile, Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version, Sec-CH-UA-Arch, Sec-CH-UA-Bitness, Sec-CH-UA-Model, Sec-CH-UA-Full-Version-List',
  );
  next();
});
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
    quizPublicTtlDays: formatQuizTtlDays(getDbMeta().quizPublicTtlMs),
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
  const clientTitle = sanitizeText(req.body.clientTitle || '');
  const answerMode = String(req.body.answerMode || 'single');
  const answerIndex = Number(req.body.answerIndex);
  const optionCount = Number(req.body.optionCount);
  const questionMode = String(req.body.questionMode || 'manual');
  const questionLimit = questionMode === 'all' ? null : Number(req.body.questionLimit);
  const originalFilename = normalizeUploadedFilename(sourceFile?.originalname || '');
  const sourceExtension = path.extname(originalFilename).toLowerCase();

  if (!sourceFile) {
    return res.status(400).json({ error: 'Потрібно завантажити файл із тестами.' });
  }

  if (!clientTitle) {
    return res.status(400).json({ error: 'Потрібно вказати назву тесту.' });
  }

  if (!SUPPORTED_UPLOAD_EXTENSIONS.includes(sourceExtension)) {
    return res.status(400).json({
      error: `Підтримуються лише файли ${SUPPORTED_UPLOAD_EXTENSIONS.join(', ')}.`,
    });
  }

  if (!Number.isInteger(optionCount) || optionCount < 2 || optionCount > 10) {
    return res.status(400).json({ error: 'Кількість варіантів відповіді має бути від 2 до 10.' });
  }

  if (!['single', 'file'].includes(answerMode)) {
    return res.status(400).json({ error: 'Невірний режим відповідей.' });
  }

  if (answerMode === 'single' && (!Number.isInteger(answerIndex) || answerIndex < 1 || answerIndex > optionCount)) {
    return res.status(400).json({ error: `Правильний варіант має бути від 1 до ${optionCount}.` });
  }

  if (answerMode === 'file') {
    if (!answerFile) {
      return res.status(400).json({ error: 'Потрібно завантажити окремий файл із відповідями.' });
    }

    const answerFilename = normalizeUploadedFilename(answerFile.originalname || '');
    const answerExtension = path.extname(answerFilename).toLowerCase();
    if (!SUPPORTED_ANSWER_EXTENSIONS.includes(answerExtension)) {
      return res.status(400).json({
        error: `Підтримуються лише файли відповідей ${SUPPORTED_ANSWER_EXTENSIONS.join(', ')}.`,
      });
    }
  }

  if (questionMode !== 'all' && (!Number.isInteger(questionLimit) || questionLimit < 1)) {
    return res.status(400).json({ error: 'Кількість питань має бути більшою за 0.' });
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
    const savedUploads = saveUploadedQuizFiles({
      sourceFile,
      answerFile,
    });

    const draft = createQuizDraft({
      title: clientTitle,
      sourceFilename: buildStoredFilename(clientTitle),
      answerIndex: answerMode === 'single' ? answerIndex : 0,
      requestedCount,
      questions: parsedQuiz.questions,
      reviewBlocks: parsedQuiz.reviewBlocks,
      rawModelJson: parsedQuiz.rawModelJson,
      sourceUploadPath: savedUploads.sourceUploadPath,
      sourceUploadName: savedUploads.sourceUploadName,
      answerUploadPath: savedUploads.answerUploadPath,
      answerUploadName: savedUploads.answerUploadName,
    });

    return res.status(201).json({
      draftToken: draft.draftToken,
      title: clientTitle,
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

app.post('/api/ai-quizzes/prepare', upload.fields([
  { name: 'sourceFile', maxCount: 1 },
  { name: 'pdf', maxCount: 1 },
]), async (req, res, next) => {
  const sourceFile = req.files?.sourceFile?.[0] || req.files?.pdf?.[0] || null;
  const clientTitle = sanitizeText(req.body.clientTitle || '');
  const accessCode = String(req.body.accessCode || '').trim();
  const optionCount = Number(req.body.optionCount);
  const questionMode = String(req.body.questionMode || 'manual');
  const questionLimit = questionMode === 'all' ? null : Number(req.body.questionLimit);
  const originalFilename = normalizeUploadedFilename(sourceFile?.originalname || '');
  const sourceExtension = path.extname(originalFilename).toLowerCase();

  if (!sourceFile) {
    return res.status(400).json({ error: 'Please attach a source file.' });
  }

  if (!clientTitle) {
    return res.status(400).json({ error: 'Please enter a test title.' });
  }

  if (!accessCode) {
    return res.status(400).json({ error: 'Enter an access code.' });
  }

  if (!SUPPORTED_UPLOAD_EXTENSIONS.includes(sourceExtension)) {
    return res.status(400).json({
      error: `Supported file types: ${SUPPORTED_UPLOAD_EXTENSIONS.join(', ')}.`,
    });
  }

  if (!Number.isInteger(optionCount) || optionCount < 2 || optionCount > 10) {
    return res.status(400).json({ error: 'Option count must be between 2 and 10.' });
  }

  if (questionMode !== 'all' && (!Number.isInteger(questionLimit) || questionLimit < 1)) {
    return res.status(400).json({ error: 'Question count must be greater than 0.' });
  }

  try {
    const code = inspectAccessCode(accessCode);
    if (!code) {
      return res.status(404).json({ error: 'Code not found or already revoked.' });
    }

    if (!code.isReusable && code.usedAt) {
      return res.status(409).json({ error: 'This code has already been used.' });
    }

    const parsedQuiz = await parseQuizFromFile({
      buffer: sourceFile.buffer,
      filename: originalFilename,
      answerIndex: 1,
      limit: questionMode === 'all' ? null : questionLimit,
      optionCount,
      answerKey: null,
    });

    if (code.expectedQuestionCount && parsedQuiz.questions.length > code.expectedQuestionCount) {
      return res.status(422).json({
        error: `This code supports up to ${code.expectedQuestionCount} questions, but ${parsedQuiz.questions.length} were found.`,
      });
    }

    const solved = await solveQuizAnswersWithAI({
      filename: originalFilename,
      extractedText: parsedQuiz.extractedText,
      questions: parsedQuiz.questions,
      optionCount,
    });

    const requestedCount = questionMode === 'all'
      ? solved.questions.length
      : questionLimit;

    const savedUploads = saveUploadedQuizFiles({ sourceFile, answerFile: null });

    const draft = createQuizDraft({
      title: clientTitle,
      sourceFilename: buildStoredFilename(clientTitle),
      answerIndex: 0,
      requestedCount,
      questions: solved.questions,
      reviewBlocks: parsedQuiz.reviewBlocks,
      rawModelJson: {
        ...parsedQuiz.rawModelJson,
        answerMode: 'openai-double-check',
        aiPrimaryModel: solved.primaryModel,
        aiCheckModel: solved.checkModel,
        aiAnswerKeyText: solved.answerKeyText,
        aiDisagreements: solved.disagreements,
      },
      sourceUploadPath: savedUploads.sourceUploadPath,
      sourceUploadName: savedUploads.sourceUploadName,
      answerUploadPath: null,
      answerUploadName: null,
    });

    return res.status(201).json({
      draftToken: draft.draftToken,
      title: clientTitle,
      parsedCount: solved.questions.length,
      requestedCount,
      adminContactTg: normalizePublicUsername(process.env.ADMIN_CONTACT_TG || process.env.PUBLIC_ADMIN_TG || ''),
      aiPrimaryModel: solved.primaryModel,
      aiCheckModel: solved.checkModel,
      aiDisagreements: solved.disagreements,
      aiAnswerKeyPreview: solved.answerKeyText.split('\n').slice(0, 10),
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/access-codes/check', (req, res) => {
  const accessCode = String(req.body.accessCode || '').trim();
  const hasParsedCount = req.body.parsedCount !== undefined && req.body.parsedCount !== null && req.body.parsedCount !== '';
  const parsedCount = hasParsedCount ? Number(req.body.parsedCount) : null;

  if (!accessCode) {
    return res.status(400).json({ error: 'Enter an access code.' });
  }

  if (hasParsedCount && (!Number.isInteger(parsedCount) || parsedCount < 1)) {
    return res.status(400).json({ error: 'Invalid parsed question count.' });
  }

  const code = inspectAccessCode(accessCode);
  if (!code) {
    return res.status(404).json({ error: 'Code not found or already revoked.' });
  }

  if (!code.isReusable && code.usedAt) {
    return res.status(409).json({ error: 'This code has already been used.' });
  }

  if (hasParsedCount && code.expectedQuestionCount && parsedCount > code.expectedQuestionCount) {
    return res.status(422).json({
      error: `This code supports up to ${code.expectedQuestionCount} questions, but ${parsedCount} were found.`,
    });
  }

  return res.json({
    ok: true,
    label: code.label,
    siteType: code.siteType,
    siteTypeLabel: formatSiteType(code.siteType),
    clientTgUsername: code.clientTgUsername,
    expectedQuestionCount: code.expectedQuestionCount,
    price: code.price,
    isReusable: code.isReusable,
    fitsParsedCount: !hasParsedCount || !code.expectedQuestionCount || parsedCount <= code.expectedQuestionCount,
  });
});

app.post('/api/quizzes/finalize', async (req, res, next) => {
  const draftToken = String(req.body.draftToken || '');
  const providedAccessCode = String(req.body.accessCode || '').trim();
  const creatorSnapshot = buildCreatorSnapshot(req, req.body.creatorProfile);

  if (!draftToken) {
    return res.status(400).json({ error: 'Немає чернетки. Спочатку передайте файл ще раз.' });
  }

  const draft = inspectQuizDraft(draftToken);
  const requiresExplicitCode = String(draft?.rawModel?.answerMode || '') === 'openai-double-check';
  const accessCode = requiresExplicitCode
    ? providedAccessCode
    : resolveFinalizeAccessCode(providedAccessCode);

  if (requiresExplicitCode && !accessCode) {
    return res.status(400).json({ error: 'Enter an access code.' });
  }

  const reservation = reserveAccessCode(accessCode);
  if (!reservation) {
    return res.status(403).json({ error: 'Код недійсний, уже використаний або зараз обробляється.' });
  }

  try {
    const savedQuiz = finalizeQuizFromDraftReservation({
      reservationToken: reservation.reservationToken,
      draftToken,
      creatorSnapshot,
    });

    const quiz = getQuizBySlug(savedQuiz.slug);
    return res.status(201).json({
      id: savedQuiz.id,
      slug: savedQuiz.slug,
      title: quiz.title,
      parsedCount: quiz.parsedCount,
      aiDisagreements: Array.isArray(quiz.rawModelJson?.aiDisagreements) ? quiz.rawModelJson.aiDisagreements : [],
      quizUrl: buildAbsoluteUrl(req, `/quiz/${savedQuiz.slug}`),
      downloadUrl: buildAbsoluteUrl(req, `/api/download/${savedQuiz.slug}`),
      apiUrl: buildAbsoluteUrl(req, `/api/quizzes/${savedQuiz.slug}`),
      siteType: savedQuiz.siteType,
      siteTypeLabel: formatSiteType(savedQuiz.siteType),
      warningDeviceLimit: getDeviceWarningLimit(savedQuiz.siteType),
      clientTgUsername: savedQuiz.clientTgUsername,
      expectedQuestionCount: savedQuiz.expectedQuestionCount,
      expiresAt: savedQuiz.expiresAt,
      creatorTracked: Boolean(savedQuiz.creatorSnapshot?.fingerprint || savedQuiz.creatorSnapshot?.browserId),
      creatorBrowserId: savedQuiz.creatorSnapshot?.browserId || null,
      creatorFingerprint: savedQuiz.creatorSnapshot?.fingerprint || null,
    });
  } catch (error) {
    releaseReservation(reservation.reservationToken);
    return next(error);
  }
});

app.get('/api/quizzes/:slug', (req, res) => {
  const quiz = getQuizBySlug(req.params.slug);
  if (!quiz) {
    return res.status(404).json({ error: 'Тест не знайдено.' });
  }

  if (quiz.bannedAt) {
    return res.status(410).json({ error: 'Тест заблокований адміністратором.' });
  }

  if (isQuizExpired(quiz)) {
    return res.status(410).json({ error: 'Строк дії публічного посилання на цей тест завершився.' });
  }

  return res.json({
    slug: quiz.slug,
    title: quiz.title,
    sourceFilename: quiz.sourceFilename,
    answerIndex: quiz.answerIndex,
    requestedCount: quiz.requestedCount,
    parsedCount: quiz.parsedCount,
    createdAt: quiz.createdAt,
    expiresAt: quiz.expiresAt,
    questions: quiz.questions,
    aiDisagreements: Array.isArray(quiz.rawModelJson?.aiDisagreements) ? quiz.rawModelJson.aiDisagreements : [],
    siteType: quiz.siteType,
    siteTypeLabel: formatSiteType(quiz.siteType),
    clientTgUsername: quiz.clientTgUsername,
  });
});

app.get('/quiz/:slug', (req, res) => {
  const quiz = getQuizBySlug(req.params.slug);
  if (!quiz) {
    return res.status(404).type('text/plain').send('Тест не знайдено');
  }

  if (quiz.bannedAt) {
    return res.status(410).type('html').send(renderUnavailableQuizHtml(quiz.title));
  }

  if (isQuizExpired(quiz)) {
    return res.status(410).type('html').send(renderUnavailableQuizHtml(quiz.title, 'expired'));
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

  res.type('html').send(renderHostedQuizHtml(quiz, {
    quizUrl: buildAbsoluteUrl(req, `/quiz/${quiz.slug}`),
    reportUrl: buildAbsoluteUrl(req, `/api/quizzes/${quiz.slug}/report`),
  }));
});

app.post('/api/quizzes/:slug/report', (req, res, next) => {
  try {
    const quiz = getQuizBySlug(req.params.slug);
    if (!quiz) {
      return res.status(404).json({ error: 'Ð¢ÐµÑÑ‚ Ð½Ðµ Ð·Ð½Ð°Ð¹Ð´ÐµÐ½Ð¾.' });
    }

    const report = createQuizReport({
      quizId: quiz.id,
      note: sanitizeText(req.body.note || ''),
      reporterSnapshot: buildReportSnapshot(req, req.body),
    });

    if (!report) {
      return res.status(400).json({ error: 'ÐÐµ Ð²Ð´Ð°Ð»Ð¾ÑÑ ÑÑ‚Ð²Ð¾Ñ€Ð¸Ñ‚Ð¸ Ð·Ð²ÐµÑ€Ð½ÐµÐ½Ð½Ñ.' });
    }

    return res.status(201).json({
      ok: true,
      reportId: report.id,
      createdAt: report.createdAt,
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/reports/upload', upload.fields([
  { name: 'sourceFile', maxCount: 1 },
  { name: 'answerFile', maxCount: 1 },
]), (req, res, next) => {
  try {
    const sourceFile = req.files?.sourceFile?.[0] || null;
    const answerFile = req.files?.answerFile?.[0] || null;

    if (!sourceFile && !answerFile) {
      return res.status(400).json({ error: 'Please attach at least one file.' });
    }

    const savedUploads = saveUploadedQuizFiles({ sourceFile, answerFile });
    const report = createUploadReport({
      title: sanitizeText(req.body.title || ''),
      note: sanitizeText(req.body.note || ''),
      sourceUploadPath: savedUploads.sourceUploadPath,
      sourceUploadName: savedUploads.sourceUploadName,
      answerUploadPath: savedUploads.answerUploadPath,
      answerUploadName: savedUploads.answerUploadName,
      reporterSnapshot: buildReportSnapshot(req, req.body),
    });

    return res.status(201).json({
      ok: true,
      reportType: 'upload',
      reportId: report.id,
      createdAt: report.createdAt,
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/download/:slug', (req, res) => {
  const quiz = getQuizBySlug(req.params.slug);
  if (!quiz) {
    return res.status(404).json({ error: 'Тест не знайдено.' });
  }

  if (quiz.bannedAt) {
    return res.status(410).json({ error: 'Тест заблокований адміністратором.' });
  }

  if (isQuizExpired(quiz)) {
    return res.status(410).json({ error: 'Строк дії публічного посилання на цей тест завершився.' });
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

app.get('/api/admin/quizzes/:id', requireAdminSecret, (req, res) => {
  const quiz = getQuizById(req.params.id);
  if (!quiz) {
    return res.status(404).json({ error: 'Quiz not found.' });
  }

  return res.json(serializeAdminQuiz(quiz));
});

app.get('/api/admin/reports', requireAdminSecret, (req, res) => {
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 30)));
  const quizReports = listQuizReports(limit);
  const uploadReports = listUploadReports(limit);
  return res.json({
    reports: [...quizReports, ...uploadReports]
      .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
      .slice(0, limit),
  });
});

app.get('/api/admin/reports/:id', requireAdminSecret, (req, res) => {
  const report = getAdminReportByParam(req.params.id);
  if (!report) {
    return res.status(404).json({ error: 'Report not found.' });
  }

  return res.json(report);
});

app.get('/api/admin/reports/:id/files/:kind', requireAdminSecret, (req, res) => {
  const report = getAdminReportByParam(req.params.id);
  if (!report) {
    return res.status(404).json({ error: 'Report not found.' });
  }

  const fileRef = resolveReportFileRef(report, req.params.kind);
  if (!fileRef) {
    return res.status(404).json({ error: 'File not found.' });
  }

  if (!fs.existsSync(fileRef.filePath)) {
    return res.status(404).json({ error: 'Saved file missing on disk.' });
  }

  return res.download(fileRef.filePath, fileRef.downloadName);
});

app.post('/api/admin/quizzes/:slug/ban', requireAdminSecret, (req, res) => {
  const banned = req.body?.banned !== false;
  const quiz = setQuizBanStatus(req.params.slug, banned);

  if (!quiz) {
    return res.status(404).json({ error: 'Тест не знайдено.' });
  }

  return res.json({
    slug: quiz.slug,
    bannedAt: quiz.bannedAt,
  });
});

app.delete('/api/admin/quizzes/:id', requireAdminSecret, (req, res) => {
  const quiz = deleteQuizById(req.params.id);
  if (!quiz) {
    return res.status(404).json({ error: 'Тест не знайдено.' });
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
      error: `Файл занадто великий. Максимум ${Number(process.env.MAX_UPLOAD_MB || 20)} MB.`,
    });
  }

  const statusCode = Number(error?.statusCode || 500);
  const message = error?.message || 'Внутрішня помилка сервера.';
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
    return res.status(403).json({ error: 'Невірний admin secret.' });
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

function renderUnavailableQuizHtml(title, reason = 'banned') {
  const safeTitle = htmlEscape(sanitizeText(title) || 'Тест');
  const description = reason === 'expired'
    ? 'Строк дії публічного посилання на цей тест завершився.'
    : 'Цей тест був вимкнений адміністратором.';
  return `<!doctype html>
<html lang="uk">
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
    <h1>Тест недоступний</h1>
    <p>${description}</p>
  </section>
</body>
</html>`;
}

function isQuizExpired(quiz) {
  const expiresAt = Number(quiz?.expiresAt || 0);
  return expiresAt > 0 && Date.now() >= expiresAt;
}

function formatQuizTtlDays(ttlMs) {
  const numericTtl = Number(ttlMs || 0);
  if (!Number.isFinite(numericTtl) || numericTtl <= 0) {
    return 0;
  }

  return Math.round((numericTtl / (24 * 60 * 60 * 1000)) * 100) / 100;
}

function normalizePublicUsername(value) {
  const normalized = String(value || '').trim().replace(/^@+/, '');
  return normalized ? `@${normalized}` : '';
}

function buildStoredFilename(title) {
  const safeTitle = sanitizeText(title || '') || 'Тест';
  return `${safeTitle}.json`;
}

function resolveFinalizeAccessCode(rawAccessCode) {
  const directCode = String(rawAccessCode || '').trim();
  if (directCode) {
    return directCode;
  }

  return String(
    process.env.DEFAULT_PUBLIC_ACCESS_CODE
    || process.env.UNLIMITED_EVA_ACCESS_CODE
    || '',
  ).trim();
}

function formatSiteType(siteType) {
  return String(siteType || '') === '2' ? 'Груповий' : 'Одиночний';
}

function getDeviceWarningLimit(siteType) {
  return String(siteType || '') === '2' ? 20 : 2;
}

function saveUploadedQuizFiles({ sourceFile, answerFile }) {
  const batchDir = path.join(uploadsDir, randomToken());
  fs.mkdirSync(batchDir, { recursive: true });

  const sourceUpload = sourceFile
    ? writeSavedUpload(batchDir, 'source', sourceFile.originalname, sourceFile.buffer)
    : null;
  const answerUpload = answerFile
    ? writeSavedUpload(batchDir, 'answers', answerFile.originalname, answerFile.buffer)
    : null;

  return {
    sourceUploadPath: sourceUpload?.filePath || null,
    sourceUploadName: sourceUpload?.originalName || null,
    answerUploadPath: answerUpload?.filePath || null,
    answerUploadName: answerUpload?.originalName || null,
  };
}

function writeSavedUpload(targetDir, prefix, originalName, buffer) {
  const normalizedName = sanitizeStoredUploadName(originalName);
  const filePath = path.join(targetDir, `${prefix}-${normalizedName}`);
  fs.writeFileSync(filePath, buffer);

  return {
    filePath,
    originalName: normalizedName,
  };
}

function sanitizeStoredUploadName(value) {
  const normalized = normalizeUploadedFilename(value || '').trim();
  if (!normalized) {
    return 'upload.bin';
  }

  return path.basename(normalized).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 160) || 'upload.bin';
}

function buildReportSnapshot(req, body) {
  const currentQuestion = Number(body?.currentQuestion);
  const clientProfile = sanitizeReportClientProfile(body?.reporterProfileJson);
  return {
    createdAt: Date.now(),
    note: sanitizeText(body?.note || ''),
    pageUrl: String(body?.pageUrl || '').trim().slice(0, 400),
    currentQuestion: Number.isInteger(currentQuestion) && currentQuestion > 0 ? currentQuestion : null,
    request: {
      ip: getClientIp(req),
      userAgent: String(req.get('user-agent') || '').trim().slice(0, 500),
      referer: String(req.get('referer') || '').trim().slice(0, 400),
    },
    device: {
      deviceId: getCookieValue(req, 'pdmu_device_id') || null,
    },
    client: clientProfile,
  };
}

function resolveReportFileRef(report, kind) {
  const normalizedKind = String(kind || '').trim().toLowerCase();
  if (normalizedKind === 'source') {
    return report.sourceUploadPath
      ? {
        filePath: report.sourceUploadPath,
        downloadName: report.sourceUploadName || path.basename(report.sourceUploadPath),
      }
      : null;
  }

  if (normalizedKind === 'answer') {
    return report.answerUploadPath
      ? {
        filePath: report.answerUploadPath,
        downloadName: report.answerUploadName || path.basename(report.answerUploadPath),
      }
      : null;
  }

  return null;
}

function getAdminReportByParam(rawId) {
  const text = String(rawId || '').trim();
  if (/^u-\d+$/i.test(text)) {
    return getUploadReportById(text.replace(/^u-/i, ''));
  }

  if (/^q-\d+$/i.test(text)) {
    return getQuizReportById(text.replace(/^q-/i, ''));
  }

  return getQuizReportById(text) || getUploadReportById(text);
}

function serializeAdminQuiz(quiz) {
  return {
    id: quiz.id,
    slug: quiz.slug,
    title: quiz.title,
    sourceFilename: quiz.sourceFilename,
    answerIndex: quiz.answerIndex,
    requestedCount: quiz.requestedCount,
    parsedCount: quiz.parsedCount,
    createdAt: quiz.createdAt,
    expiresAt: quiz.expiresAt,
    bannedAt: quiz.bannedAt,
    siteType: quiz.siteType,
    siteTypeLabel: formatSiteType(quiz.siteType),
    clientTgUsername: quiz.clientTgUsername,
    expectedQuestionCount: quiz.expectedQuestionCount,
    price: quiz.price,
    codeLabel: quiz.codeLabel,
    reviewBlocks: quiz.reviewBlocks,
    deviceCount: quiz.deviceCount || 0,
    lastSeenAt: quiz.lastSeenAt || null,
    devices: Array.isArray(quiz.devices) ? quiz.devices : [],
    creatorSnapshot: quiz.creatorSnapshot || {},
  };
}

function buildCreatorSnapshot(req, rawProfile) {
  const clientProfile = sanitizeCreatorClientProfile(rawProfile);
  const requestSnapshot = sanitizeCreatorRequestSnapshot(req);
  const fingerprintPayload = {
    browserId: clientProfile.browserId || '',
    requestIp: requestSnapshot.ip || '',
    requestUserAgent: requestSnapshot.userAgent || '',
    language: clientProfile.language || '',
    timezone: clientProfile.timezone || '',
    platform: clientProfile.platform || clientProfile.userAgentData?.platform || requestSnapshot.secChUaPlatform || '',
    screen: clientProfile.screen || null,
    viewport: clientProfile.viewport || null,
    deviceMemory: clientProfile.deviceMemory || null,
    hardwareConcurrency: clientProfile.hardwareConcurrency || null,
    maxTouchPoints: clientProfile.maxTouchPoints || 0,
  };

  return {
    capturedAt: Date.now(),
    browserId: clientProfile.browserId || null,
    fingerprint: hashValue(JSON.stringify(fingerprintPayload)),
    fingerprintVersion: 1,
    deviceClass: clientProfile.deviceClass || inferDeviceClass(clientProfile, requestSnapshot),
    creationSource: 'admin-form',
    request: requestSnapshot,
    client: clientProfile,
  };
}

function sanitizeCreatorRequestSnapshot(req) {
  return {
    ip: trimString(getClientIp(req), 120),
    forwardedFor: trimString(req.get('x-forwarded-for'), 300),
    realIp: trimString(req.get('x-real-ip'), 120),
    cfConnectingIp: trimString(req.get('cf-connecting-ip'), 120),
    host: trimString(req.get('host'), 160),
    origin: trimString(req.get('origin'), 300),
    referer: trimString(req.get('referer'), 400),
    userAgent: trimString(req.get('user-agent'), 600),
    acceptLanguage: trimString(req.get('accept-language'), 300),
    secChUa: trimString(req.get('sec-ch-ua'), 300),
    secChUaMobile: trimString(req.get('sec-ch-ua-mobile'), 40),
    secChUaPlatform: trimString(req.get('sec-ch-ua-platform'), 120),
    secChUaPlatformVersion: trimString(req.get('sec-ch-ua-platform-version'), 120),
    secChUaArch: trimString(req.get('sec-ch-ua-arch'), 120),
    secChUaBitness: trimString(req.get('sec-ch-ua-bitness'), 120),
    secChUaModel: trimString(req.get('sec-ch-ua-model'), 160),
    secChUaFullVersionList: trimString(req.get('sec-ch-ua-full-version-list'), 400),
  };
}

function sanitizeCreatorClientProfile(rawProfile) {
  if (!rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) {
    return {};
  }

  return {
    browserId: trimString(rawProfile.browserId, 120),
    capturedAt: toSafeInteger(rawProfile.capturedAt),
    pageUrl: trimString(rawProfile.pageUrl, 400),
    referrer: trimString(rawProfile.referrer, 400),
    language: trimString(rawProfile.language, 80),
    languages: sanitizeStringArray(rawProfile.languages, 12, 80),
    timezone: trimString(rawProfile.timezone, 120),
    locale: trimString(rawProfile.locale, 120),
    platform: trimString(rawProfile.platform, 120),
    vendor: trimString(rawProfile.vendor, 120),
    userAgent: trimString(rawProfile.userAgent, 600),
    cookieEnabled: typeof rawProfile.cookieEnabled === 'boolean' ? rawProfile.cookieEnabled : null,
    doNotTrack: trimString(rawProfile.doNotTrack, 40),
    webdriver: typeof rawProfile.webdriver === 'boolean' ? rawProfile.webdriver : null,
    hardwareConcurrency: toSafeNumber(rawProfile.hardwareConcurrency, 0, 256),
    deviceMemory: toSafeNumber(rawProfile.deviceMemory, 0, 2048),
    maxTouchPoints: toSafeNumber(rawProfile.maxTouchPoints, 0, 32),
    deviceClass: trimString(rawProfile.deviceClass, 40),
    screen: sanitizeSizeInfo(rawProfile.screen),
    viewport: sanitizeSizeInfo(rawProfile.viewport, true),
    connection: sanitizeConnectionInfo(rawProfile.connection),
    userAgentData: sanitizeUserAgentData(rawProfile.userAgentData),
  };
}

function sanitizeUserAgentData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return {
    mobile: typeof value.mobile === 'boolean' ? value.mobile : null,
    platform: trimString(value.platform, 120),
    architecture: trimString(value.architecture, 120),
    bitness: trimString(value.bitness, 40),
    model: trimString(value.model, 160),
    platformVersion: trimString(value.platformVersion, 120),
    uaFullVersion: trimString(value.uaFullVersion, 120),
    wow64: typeof value.wow64 === 'boolean' ? value.wow64 : null,
    brands: Array.isArray(value.brands)
      ? value.brands.slice(0, 10).map((brand) => ({
        brand: trimString(brand?.brand, 120),
        version: trimString(brand?.version, 80),
      }))
      : [],
    fullVersionList: Array.isArray(value.fullVersionList)
      ? value.fullVersionList.slice(0, 10).map((brand) => ({
        brand: trimString(brand?.brand, 120),
        version: trimString(brand?.version, 80),
      }))
      : [],
  };
}

function sanitizeConnectionInfo(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return {
    effectiveType: trimString(value.effectiveType, 40),
    downlink: toSafeNumber(value.downlink, 0, 100000),
    rtt: toSafeNumber(value.rtt, 0, 100000),
    saveData: typeof value.saveData === 'boolean' ? value.saveData : null,
  };
}

function sanitizeSizeInfo(value, withRatio = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const sanitized = {
    width: toSafeInteger(value.width, 0, 20000),
    height: toSafeInteger(value.height, 0, 20000),
    availWidth: toSafeInteger(value.availWidth, 0, 20000),
    availHeight: toSafeInteger(value.availHeight, 0, 20000),
    colorDepth: toSafeInteger(value.colorDepth, 0, 128),
    pixelDepth: toSafeInteger(value.pixelDepth, 0, 128),
  };

  if (withRatio) {
    sanitized.pixelRatio = toSafeNumber(value.pixelRatio, 0.1, 20);
  }

  return sanitized;
}

function inferDeviceClass(clientProfile, requestSnapshot) {
  const explicit = trimString(clientProfile?.deviceClass, 40);
  if (explicit) {
    return explicit;
  }

  if (clientProfile?.userAgentData?.mobile || Number(clientProfile?.maxTouchPoints || 0) > 1) {
    const viewportWidth = Number(clientProfile?.viewport?.width || 0);
    return viewportWidth && viewportWidth <= 900 ? 'mobile' : 'tablet';
  }

  const ua = `${clientProfile?.userAgent || ''} ${requestSnapshot?.userAgent || ''}`.toLowerCase();
  if (/ipad|tablet/i.test(ua)) {
    return 'tablet';
  }

  if (/mobile|android|iphone/i.test(ua)) {
    return 'mobile';
  }

  return 'desktop';
}

function sanitizeStringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, maxItems)
    .map((item) => trimString(item, maxLength))
    .filter(Boolean);
}

function trimString(value, maxLength) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  return normalized.slice(0, maxLength);
}

function toSafeInteger(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < min || numericValue > max) {
    return null;
  }

  return numericValue;
}

function toSafeNumber(value, min, max) {
  if (value == null || value === '') {
    return null;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < min || numericValue > max) {
    return null;
  }

  return Math.round(numericValue * 100) / 100;
}

function sanitizeReportClientProfile(rawValue) {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return {
      browserId: trimString(parsed.browserId, 120),
      language: trimString(parsed.language, 80),
      timezone: trimString(parsed.timezone, 120),
      platform: trimString(parsed.platform, 120),
      userAgent: trimString(parsed.userAgent, 600),
      deviceClass: trimString(parsed.deviceClass, 40),
      pageUrl: trimString(parsed.pageUrl, 400),
    };
  } catch {
    return null;
  }
}
