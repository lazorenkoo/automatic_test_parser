import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import archiver from 'archiver';
import {
  createAccessCodes,
  finalizeQuizFromReservation,
  getDbMeta,
  getQuizBySlug,
  releaseReservation,
  reserveAccessCode,
} from './src/db.js';
import { parseQuizFromFile, SUPPORTED_UPLOAD_EXTENSIONS } from './src/parser.js';
import { buildZipBundle, renderHostedQuizHtml } from './src/quiz-assets.js';
import { buildAbsoluteUrl, normalizeUploadedFilename, sanitizeText } from './src/utils.js';

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
    parser: 'local-v1',
    supportedFileTypes: SUPPORTED_UPLOAD_EXTENSIONS,
  });
});

app.post('/api/quizzes', upload.fields([
  { name: 'sourceFile', maxCount: 1 },
  { name: 'pdf', maxCount: 1 },
]), async (req, res, next) => {
  const file = req.files?.sourceFile?.[0] || req.files?.pdf?.[0] || null;
  const answerIndex = Number(req.body.answerIndex);
  const optionCount = Number(req.body.optionCount);
  const questionLimit = Number(req.body.questionLimit);
  const accessCode = String(req.body.accessCode || '');
  const originalFilename = normalizeUploadedFilename(file?.originalname || '');
  const extension = path.extname(originalFilename).toLowerCase();

  if (!file) {
    return res.status(400).json({ error: 'Нужно загрузить файл с тестами.' });
  }

  if (!SUPPORTED_UPLOAD_EXTENSIONS.includes(extension)) {
    return res.status(400).json({
      error: `Поддерживаются только файлы ${SUPPORTED_UPLOAD_EXTENSIONS.join(', ')}.`,
    });
  }

  if (!Number.isInteger(optionCount) || optionCount < 2 || optionCount > 10) {
    return res.status(400).json({ error: 'Количество вариантов ответа должно быть от 2 до 10.' });
  }

  if (!Number.isInteger(answerIndex) || answerIndex < 1 || answerIndex > optionCount) {
    return res.status(400).json({ error: `Правильный вариант должен быть от 1 до ${optionCount}.` });
  }

  if (!Number.isInteger(questionLimit) || questionLimit < 1) {
    return res.status(400).json({ error: 'Количество вопросов должно быть больше 0.' });
  }

  const reservation = reserveAccessCode(accessCode);
  if (!reservation) {
    return res.status(403).json({ error: 'Код недействителен, уже использован или сейчас обрабатывается.' });
  }

  try {
    const parsedQuiz = await parseQuizFromFile({
      buffer: file.buffer,
      filename: originalFilename,
      answerIndex,
      limit: questionLimit,
      optionCount,
    });

    const savedQuiz = finalizeQuizFromReservation({
      reservationToken: reservation.reservationToken,
      title: sanitizeText(parsedQuiz.title) || 'Medical quiz',
      sourceFilename: originalFilename,
      answerIndex,
      requestedCount: questionLimit,
      questions: parsedQuiz.questions,
      rawModelJson: parsedQuiz.rawModelJson,
    });

    const quiz = getQuizBySlug(savedQuiz.slug);

    return res.status(201).json({
      slug: savedQuiz.slug,
      title: quiz.title,
      parsedCount: quiz.parsedCount,
      quizUrl: buildAbsoluteUrl(req, `/quiz/${savedQuiz.slug}`),
      downloadUrl: buildAbsoluteUrl(req, `/api/download/${savedQuiz.slug}`),
      apiUrl: buildAbsoluteUrl(req, `/api/quizzes/${savedQuiz.slug}`),
      notes: parsedQuiz.notes,
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

  return res.json({
    slug: quiz.slug,
    title: quiz.title,
    sourceFilename: quiz.sourceFilename,
    answerIndex: quiz.answerIndex,
    requestedCount: quiz.requestedCount,
    parsedCount: quiz.parsedCount,
    createdAt: quiz.createdAt,
    questions: quiz.questions,
  });
});

app.get('/quiz/:slug', (req, res) => {
  const quiz = getQuizBySlug(req.params.slug);
  if (!quiz) {
    return res.status(404).type('text/plain').send('Quiz not found');
  }

  res.type('html').send(renderHostedQuizHtml(quiz));
});

app.get('/api/download/:slug', (req, res) => {
  const quiz = getQuizBySlug(req.params.slug);
  if (!quiz) {
    return res.status(404).json({ error: 'Тест не найден.' });
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

app.post('/api/admin/codes', (req, res) => {
  const headerSecret = String(req.get('X-Admin-Secret') || '');
  const expectedSecret = String(process.env.ADMIN_SECRET || '');

  if (!expectedSecret || headerSecret !== expectedSecret) {
    return res.status(403).json({ error: 'Неверный admin secret.' });
  }

  const count = Number(req.body.count || 1);
  const label = req.body.label ? String(req.body.label) : null;
  const codes = createAccessCodes(count, label);

  return res.status(201).json({ codes });
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: `Файл слишком большой. Максимум ${Number(process.env.MAX_UPLOAD_MB || 20)} MB.`,
    });
  }

  const message = error?.message || 'Внутренняя ошибка сервера.';
  return res.status(500).json({ error: message });
});

app.listen(port, () => {
  console.log(`PDMU Quiz Service listening on http://localhost:${port}`);
  console.log(`SQLite: ${getDbMeta().dbPath}`);
});
