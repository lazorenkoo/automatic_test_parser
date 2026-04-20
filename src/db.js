import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  generateAccessCode,
  generateSlug,
  hashCode,
  normalizeCode,
  nowMs,
  randomToken,
} from './utils.js';

const dataDir = path.resolve(process.env.DATA_DIR || './data');
const dbPath = path.join(dataDir, 'pdmu.sqlite');
const reservationWindowMs = Number(process.env.CODE_RESERVATION_MINUTES || 15) * 60 * 1000;
const draftTtlMs = 24 * 60 * 60 * 1000;
const quizPublicTtlMs = resolveQuizPublicTtlMs();

fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const unlimitedAccessCode = normalizeCode(process.env.UNLIMITED_EVA_ACCESS_CODE || '');
const unlimitedAccessLabel = 'ЕВА';

db.exec(`
  CREATE TABLE IF NOT EXISTS access_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code_hash TEXT NOT NULL UNIQUE,
    label TEXT,
    site_type TEXT,
    client_tg_username TEXT,
    expected_question_count INTEGER,
    price REAL NOT NULL DEFAULT 0,
    is_reusable INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER,
    reserved_at INTEGER,
    reservation_token TEXT UNIQUE,
    used_at INTEGER,
    used_by_quiz_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS quizzes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    source_filename TEXT NOT NULL,
    answer_index INTEGER NOT NULL,
    requested_count INTEGER NOT NULL,
    parsed_count INTEGER NOT NULL,
    questions_json TEXT NOT NULL,
    review_blocks_json TEXT NOT NULL DEFAULT '[]',
    raw_model_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    banned_at INTEGER,
    code_id INTEGER NOT NULL,
    FOREIGN KEY(code_id) REFERENCES access_codes(id)
  );

  CREATE TABLE IF NOT EXISTS quiz_drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    draft_token TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    source_filename TEXT NOT NULL,
    answer_index INTEGER NOT NULL,
    requested_count INTEGER NOT NULL,
    parsed_count INTEGER NOT NULL,
    questions_json TEXT NOT NULL,
    review_blocks_json TEXT NOT NULL DEFAULT '[]',
    raw_model_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quiz_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    last_ip TEXT,
    last_user_agent TEXT,
    UNIQUE(quiz_id, device_id),
    FOREIGN KEY(quiz_id) REFERENCES quizzes(id)
  );

  CREATE INDEX IF NOT EXISTS idx_quizzes_slug ON quizzes(slug);
  CREATE INDEX IF NOT EXISTS idx_access_codes_reservation_token ON access_codes(reservation_token);
  CREATE INDEX IF NOT EXISTS idx_quiz_drafts_token ON quiz_drafts(draft_token);
  CREATE INDEX IF NOT EXISTS idx_quiz_drafts_created_at ON quiz_drafts(created_at);
  CREATE INDEX IF NOT EXISTS idx_quiz_devices_quiz_id ON quiz_devices(quiz_id);
`);

ensureColumn('access_codes', 'site_type', 'TEXT');
ensureColumn('access_codes', 'client_tg_username', 'TEXT');
ensureColumn('access_codes', 'expected_question_count', 'INTEGER');
ensureColumn('access_codes', 'price', 'REAL NOT NULL DEFAULT 0');
ensureColumn('access_codes', 'is_reusable', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('access_codes', 'revoked_at', 'INTEGER');
ensureColumn('quizzes', 'review_blocks_json', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('quiz_drafts', 'review_blocks_json', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('quizzes', 'expires_at', 'INTEGER');
ensureColumn('quizzes', 'banned_at', 'INTEGER');

const insertCodeStmt = db.prepare(`
  INSERT INTO access_codes (
    code_hash,
    label,
    site_type,
    client_tg_username,
    expected_question_count,
    price,
    is_reusable,
    created_at,
    revoked_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
`);

const upsertReusableCodeStmt = db.prepare(`
  INSERT INTO access_codes (
    code_hash,
    label,
    site_type,
    client_tg_username,
    expected_question_count,
    price,
    is_reusable,
    created_at,
    reserved_at,
    reservation_token,
    used_at,
    used_by_quiz_id
  ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, NULL, NULL, NULL, NULL)
  ON CONFLICT(code_hash) DO UPDATE SET
    label = excluded.label,
    site_type = excluded.site_type,
    client_tg_username = excluded.client_tg_username,
    expected_question_count = excluded.expected_question_count,
    price = excluded.price,
    is_reusable = 1,
    revoked_at = NULL,
    reserved_at = NULL,
    reservation_token = NULL,
    used_at = NULL,
    used_by_quiz_id = NULL
`);

const clearExpiredReservationsStmt = db.prepare(`
  UPDATE access_codes
  SET reserved_at = NULL, reservation_token = NULL
  WHERE used_at IS NULL
    AND reserved_at IS NOT NULL
    AND reserved_at < ?
`);

const reserveCodeStmt = db.prepare(`
  UPDATE access_codes
  SET reserved_at = ?, reservation_token = ?
  WHERE code_hash = ?
    AND revoked_at IS NULL
    AND (used_at IS NULL OR is_reusable = 1)
    AND reservation_token IS NULL
`);

const selectReservedCodeStmt = db.prepare(`
  SELECT
    id,
    label,
    site_type AS siteType,
    client_tg_username AS clientTgUsername,
    expected_question_count AS expectedQuestionCount,
    price,
    is_reusable AS isReusable,
    revoked_at AS revokedAt
  FROM access_codes
  WHERE reservation_token = ?
`);

const releaseReservationStmt = db.prepare(`
  UPDATE access_codes
  SET reserved_at = NULL, reservation_token = NULL
  WHERE reservation_token = ?
    AND used_at IS NULL
`);

const findCodeByTokenStmt = db.prepare(`
  SELECT
    id,
    label,
    site_type AS siteType,
    client_tg_username AS clientTgUsername,
    expected_question_count AS expectedQuestionCount,
    price,
    is_reusable AS isReusable,
    revoked_at AS revokedAt
  FROM access_codes
  WHERE reservation_token = ?
    AND revoked_at IS NULL
    AND (used_at IS NULL OR is_reusable = 1)
`);

const revokeAccessCodeStmt = db.prepare(`
  UPDATE access_codes
  SET revoked_at = ?, reserved_at = NULL, reservation_token = NULL
  WHERE code_hash = ?
    AND revoked_at IS NULL
`);

const findAccessCodeByHashStmt = db.prepare(`
  SELECT
    id,
    label,
    site_type AS siteType,
    client_tg_username AS clientTgUsername,
    expected_question_count AS expectedQuestionCount,
    price,
    is_reusable AS isReusable,
    revoked_at AS revokedAt,
    used_at AS usedAt,
    used_by_quiz_id AS usedByQuizId
  FROM access_codes
  WHERE code_hash = ?
`);

const insertQuizStmt = db.prepare(`
  INSERT INTO quizzes (
    slug,
    title,
    source_filename,
    answer_index,
    requested_count,
    parsed_count,
    questions_json,
    review_blocks_json,
    raw_model_json,
    created_at,
    expires_at,
    code_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const markCodeUsedStmt = db.prepare(`
  UPDATE access_codes
  SET used_at = ?, used_by_quiz_id = ?, reserved_at = NULL, reservation_token = NULL
  WHERE id = ?
`);

const releaseReusableCodeStmt = db.prepare(`
  UPDATE access_codes
  SET reserved_at = NULL, reservation_token = NULL
  WHERE id = ?
`)

const unlinkCodeFromQuizStmt = db.prepare(`
  UPDATE access_codes
  SET used_by_quiz_id = NULL
  WHERE used_by_quiz_id = ?
`);

const getQuizBySlugStmt = db.prepare(`
  SELECT
    q.*,
    c.site_type AS siteType,
    c.client_tg_username AS clientTgUsername,
    c.expected_question_count AS expectedQuestionCount,
    c.price AS price,
    c.label AS codeLabel
  FROM quizzes q
  LEFT JOIN access_codes c ON c.id = q.code_id
  WHERE q.slug = ?
`);

const getQuizByIdStmt = db.prepare(`
  SELECT
    q.*,
    c.site_type AS siteType,
    c.client_tg_username AS clientTgUsername,
    c.expected_question_count AS expectedQuestionCount,
    c.price AS price,
    c.label AS codeLabel
  FROM quizzes q
  LEFT JOIN access_codes c ON c.id = q.code_id
  WHERE q.id = ?
`);

const clearExpiredDraftsStmt = db.prepare(`
  DELETE FROM quiz_drafts
  WHERE created_at < ?
`);

const insertDraftStmt = db.prepare(`
  INSERT INTO quiz_drafts (
    draft_token,
    title,
    source_filename,
    answer_index,
    requested_count,
    parsed_count,
    questions_json,
    review_blocks_json,
    raw_model_json,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const getDraftByTokenStmt = db.prepare(`
  SELECT *
  FROM quiz_drafts
  WHERE draft_token = ?
`);

const deleteDraftByTokenStmt = db.prepare(`
  DELETE FROM quiz_drafts
  WHERE draft_token = ?
`);

const updateQuizContentByIdStmt = db.prepare(`
  UPDATE quizzes
  SET
    questions_json = ?,
    review_blocks_json = ?,
    parsed_count = ?,
    raw_model_json = ?
  WHERE id = ?
`);

const upsertQuizDeviceStmt = db.prepare(`
  INSERT INTO quiz_devices (
    quiz_id,
    device_id,
    first_seen_at,
    last_seen_at,
    last_ip,
    last_user_agent
  ) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(quiz_id, device_id) DO UPDATE SET
    last_seen_at = excluded.last_seen_at,
    last_ip = excluded.last_ip,
    last_user_agent = excluded.last_user_agent
`);

const listQuizzesForAdminStmt = db.prepare(`
  SELECT
    q.id,
    q.slug,
    q.title,
    q.source_filename AS sourceFilename,
    q.parsed_count AS parsedCount,
    q.requested_count AS requestedCount,
    q.created_at AS createdAt,
    q.expires_at AS expiresAt,
    q.banned_at AS bannedAt,
    c.label AS codeLabel,
    c.site_type AS siteType,
    c.client_tg_username AS clientTgUsername,
    c.expected_question_count AS expectedQuestionCount,
    c.price AS price,
    COUNT(d.id) AS deviceCount,
    MAX(d.last_seen_at) AS lastSeenAt
  FROM quizzes q
  LEFT JOIN access_codes c ON c.id = q.code_id
  LEFT JOIN quiz_devices d ON d.quiz_id = q.id
  GROUP BY q.id
  ORDER BY q.created_at DESC
`);

const updateQuizBanStatusByIdStmt = db.prepare(`
  UPDATE quizzes
  SET banned_at = ?
  WHERE id = ?
`);

const updateQuizBanStatusBySlugStmt = db.prepare(`
  UPDATE quizzes
  SET banned_at = ?
  WHERE slug = ?
`);

const getQuizDevicesStmt = db.prepare(`
  SELECT
    device_id AS deviceId,
    first_seen_at AS firstSeenAt,
    last_seen_at AS lastSeenAt,
    last_ip AS lastIp,
    last_user_agent AS lastUserAgent
  FROM quiz_devices
  WHERE quiz_id = ?
  ORDER BY last_seen_at DESC, first_seen_at DESC
`);

const deleteQuizDevicesByQuizIdStmt = db.prepare(`
  DELETE FROM quiz_devices
  WHERE quiz_id = ?
`);

const deleteQuizByIdStmt = db.prepare(`
  DELETE FROM quizzes
  WHERE id = ?
`);

const accountingSummaryStmt = db.prepare(`
  SELECT
    COUNT(*) AS usedCodeCount,
    COALESCE(SUM(price), 0) AS totalAmount
  FROM access_codes
  WHERE used_at IS NOT NULL
`);

syncUnlimitedEvaAccessCode();

export function getDbMeta() {
  return {
    dataDir,
    dbPath,
    quizPublicTtlMs,
  };
}

export function createAccessCodes(count = 1, label = null, metadata = {}) {
  const total = Math.max(1, Math.min(100, Number(count) || 1));
  const createdAt = nowMs();
  const codes = [];
  const siteType = normalizeSiteType(metadata.siteType);
  const clientTgUsername = normalizeClientUsername(metadata.clientTgUsername);
  const expectedQuestionCount = normalizeExpectedQuestionCount(metadata.expectedQuestionCount);
  const price = normalizePrice(metadata.price);

  const tx = db.transaction(() => {
    while (codes.length < total) {
      const code = generateAccessCode();
      const codeHash = hashCode(code);

      try {
        insertCodeStmt.run(
          codeHash,
          sanitizeNullableValue(label),
          siteType,
          clientTgUsername,
          expectedQuestionCount,
          price,
          0,
          createdAt,
        );
        codes.push(code);
      } catch (error) {
        if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE') {
          throw error;
        }
      }
    }
  });

  tx();
  return codes;
}

export function createReusableAccessCode(label = null, metadata = {}) {
  const createdAt = nowMs();
  const siteType = normalizeSiteType(metadata.siteType);
  const clientTgUsername = normalizeClientUsername(metadata.clientTgUsername);
  const expectedQuestionCount = normalizeExpectedQuestionCount(metadata.expectedQuestionCount);
  const price = normalizePrice(metadata.price);

  let code = '';
  while (!code) {
    const candidate = generateAccessCode();
    const candidateHash = hashCode(candidate);
    if (findAccessCodeByHashStmt.get(candidateHash)) {
      continue;
    }

    try {
      upsertReusableCodeStmt.run(
        candidateHash,
        sanitizeNullableValue(label),
        siteType,
        clientTgUsername,
        expectedQuestionCount,
        price,
        createdAt,
      );
      code = candidate;
    } catch (error) {
      if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE') {
        throw error;
      }
    }
  }

  return code;
}

export function revokeAccessCode(plainCode) {
  const normalized = normalizeCode(plainCode);
  if (!normalized) {
    return null;
  }

  const codeHash = hashCode(normalized);
  const existing = findAccessCodeByHashStmt.get(codeHash);
  if (!existing) {
    return null;
  }

  if (existing.revokedAt) {
    return {
      id: Number(existing.id),
      label: existing.label || null,
      siteType: existing.siteType || null,
      clientTgUsername: existing.clientTgUsername || null,
      expectedQuestionCount: existing.expectedQuestionCount ? Number(existing.expectedQuestionCount) : null,
      price: Number(existing.price || 0),
      isReusable: Number(existing.isReusable || 0) === 1,
      revokedAt: Number(existing.revokedAt),
      alreadyRevoked: true,
    };
  }

  revokeAccessCodeStmt.run(nowMs(), codeHash);
  const updated = findAccessCodeByHashStmt.get(codeHash);
  return {
    id: Number(updated.id),
    label: updated.label || null,
    siteType: updated.siteType || null,
    clientTgUsername: updated.clientTgUsername || null,
    expectedQuestionCount: updated.expectedQuestionCount ? Number(updated.expectedQuestionCount) : null,
    price: Number(updated.price || 0),
    isReusable: Number(updated.isReusable || 0) === 1,
    revokedAt: updated.revokedAt ? Number(updated.revokedAt) : null,
    alreadyRevoked: false,
  };
}

export function reserveAccessCode(plainCode) {
  const normalized = normalizeCode(plainCode);
  if (!normalized) {
    return null;
  }

  const reservationToken = randomToken();
  const reservedAt = nowMs();
  const staleBefore = reservedAt - reservationWindowMs;

  const tx = db.transaction(() => {
    clearExpiredReservationsStmt.run(staleBefore);
    const update = reserveCodeStmt.run(reservedAt, reservationToken, hashCode(normalized));
    if (update.changes !== 1) {
      return null;
    }

    const row = selectReservedCodeStmt.get(reservationToken);
    if (!row) {
      return null;
    }

    return {
      codeId: row.id,
      reservationToken,
      label: row.label || null,
      siteType: row.siteType || null,
      clientTgUsername: row.clientTgUsername || null,
      expectedQuestionCount: row.expectedQuestionCount ? Number(row.expectedQuestionCount) : null,
      price: Number(row.price || 0),
      isReusable: Number(row.isReusable || 0) === 1,
    };
  });

  return tx();
}

export function releaseReservation(reservationToken) {
  if (!reservationToken) {
    return;
  }

  releaseReservationStmt.run(reservationToken);
}

export function createQuizDraft({
  title,
  sourceFilename,
  answerIndex,
  requestedCount,
  questions,
  reviewBlocks = [],
  rawModelJson,
}) {
  const createdAt = nowMs();
  const draftToken = randomToken();
  const staleBefore = createdAt - draftTtlMs;

  clearExpiredDraftsStmt.run(staleBefore);
  insertDraftStmt.run(
    draftToken,
    title,
    sourceFilename,
    answerIndex,
    requestedCount,
    questions.length,
    JSON.stringify(questions),
    JSON.stringify(reviewBlocks),
    JSON.stringify(rawModelJson),
    createdAt,
  );

  return {
    draftToken,
    parsedCount: questions.length,
    requestedCount,
    createdAt,
  };
}

export function finalizeQuizFromDraftReservation({ reservationToken, draftToken }) {
  const createdAt = nowMs();
  const expiresAt = quizPublicTtlMs > 0 ? createdAt + quizPublicTtlMs : null;
  const staleBefore = createdAt - draftTtlMs;

  const tx = db.transaction(() => {
    clearExpiredDraftsStmt.run(staleBefore);

    const codeRow = findCodeByTokenStmt.get(reservationToken);
    if (!codeRow) {
      const error = new Error('Код больше не доступен. Попросите новый.');
      error.statusCode = 409;
      throw error;
    }

    const draftRow = getDraftByTokenStmt.get(draftToken);
    if (!draftRow) {
      const error = new Error('Черновик больше не доступен. Передайте файл заново.');
      error.statusCode = 410;
      throw error;
    }

    const expectedQuestionCount = codeRow.expectedQuestionCount ? Number(codeRow.expectedQuestionCount) : null;
    const parsedCount = Number(draftRow.parsed_count || 0);

    if (expectedQuestionCount && parsedCount > expectedQuestionCount) {
      const error = new Error(`Найдено вопросов: ${parsedCount}. Этот код рассчитан максимум на ${expectedQuestionCount}. Попросите новый код у администратора.`);
      error.statusCode = 422;
      throw error;
    }

    let slug = generateSlug();
    while (getQuizBySlugStmt.get(slug)) {
      slug = generateSlug();
    }

    const quizInsert = insertQuizStmt.run(
      slug,
      draftRow.title,
      draftRow.source_filename,
      draftRow.answer_index,
      draftRow.requested_count,
      parsedCount,
      draftRow.questions_json,
      draftRow.review_blocks_json,
      draftRow.raw_model_json,
      createdAt,
      expiresAt,
      codeRow.id,
    );

    if (Number(codeRow.isReusable || 0) === 1) {
      releaseReusableCodeStmt.run(codeRow.id);
    } else {
      markCodeUsedStmt.run(createdAt, quizInsert.lastInsertRowid, codeRow.id);
    }
    deleteDraftByTokenStmt.run(draftToken);

    return {
      id: Number(quizInsert.lastInsertRowid),
      slug,
      siteType: codeRow.siteType || null,
      clientTgUsername: codeRow.clientTgUsername || null,
      expectedQuestionCount,
      price: Number(codeRow.price || 0),
      codeLabel: codeRow.label || null,
      expiresAt,
    };
  });

  return tx();
}

export function getQuizBySlug(slug) {
  const row = getQuizBySlugStmt.get(slug);
  if (!row) {
    return null;
  }

  return mapQuizRow(row);
}

export function getQuizById(quizId) {
  const numericQuizId = Number(quizId);
  if (!Number.isInteger(numericQuizId) || numericQuizId < 1) {
    return null;
  }

  const row = getQuizByIdStmt.get(numericQuizId);
  if (!row) {
    return null;
  }

  const quiz = mapQuizRow(row);
  const devices = getQuizDevicesStmt.all(numericQuizId).map((device) => ({
    ...device,
    firstSeenAt: Number(device.firstSeenAt || 0),
    lastSeenAt: Number(device.lastSeenAt || 0),
  }));

  return {
    ...quiz,
    deviceCount: devices.length,
    lastSeenAt: devices[0]?.lastSeenAt || null,
    devices,
  };
}

export function recordQuizVisit({ quizId, deviceId, ip, userAgent }) {
  if (!quizId || !deviceId) {
    return;
  }

  const timestamp = nowMs();
  upsertQuizDeviceStmt.run(
    quizId,
    deviceId,
    timestamp,
    timestamp,
    sanitizeNullableValue(ip),
    sanitizeNullableValue(userAgent),
  );
}

export function listQuizzesForAdmin() {
  return listQuizzesForAdminStmt.all().map((row) => ({
    ...row,
    createdAt: Number(row.createdAt || 0),
    expiresAt: row.expiresAt ? Number(row.expiresAt) : null,
    bannedAt: row.bannedAt ? Number(row.bannedAt) : null,
    deviceCount: Number(row.deviceCount || 0),
    expectedQuestionCount: row.expectedQuestionCount ? Number(row.expectedQuestionCount) : null,
    price: Number(row.price || 0),
    lastSeenAt: row.lastSeenAt ? Number(row.lastSeenAt) : null,
    devices: getQuizDevicesStmt.all(row.id).map((device) => ({
      ...device,
      firstSeenAt: Number(device.firstSeenAt || 0),
      lastSeenAt: Number(device.lastSeenAt || 0),
    })),
  }));
}

export function getAccountingSummary() {
  const row = accountingSummaryStmt.get() || {};
  return {
    usedCodeCount: Number(row.usedCodeCount || 0),
    totalAmount: Number(row.totalAmount || 0),
  };
}

export function setQuizBanStatusById(quizId, banned) {
  const numericQuizId = Number(quizId);
  if (!Number.isInteger(numericQuizId) || numericQuizId < 1) {
    return null;
  }

  const bannedAt = banned ? nowMs() : null;
  const result = updateQuizBanStatusByIdStmt.run(bannedAt, numericQuizId);
  if (result.changes !== 1) {
    return null;
  }

  return listQuizzesForAdmin().find((quiz) => quiz.id === numericQuizId) || null;
}

export function setQuizBanStatus(slug, banned) {
  const bannedAt = banned ? nowMs() : null;
  const result = updateQuizBanStatusBySlugStmt.run(bannedAt, slug);
  if (result.changes !== 1) {
    return null;
  }

  return getQuizBySlug(slug);
}

export function deleteQuizById(quizId) {
  const numericQuizId = Number(quizId);
  if (!Number.isInteger(numericQuizId) || numericQuizId < 1) {
    return null;
  }

  const quiz = listQuizzesForAdmin().find((item) => item.id === numericQuizId);
  if (!quiz) {
    return null;
  }

  const tx = db.transaction(() => {
    deleteQuizDevicesByQuizIdStmt.run(numericQuizId);
    unlinkCodeFromQuizStmt.run(numericQuizId);
    deleteQuizByIdStmt.run(numericQuizId);
  });

  tx();
  return quiz;
}

export function fixQuizReviewBlock({ quizId, blockIndex, question }) {
  const quiz = getQuizById(quizId);
  if (!quiz) {
    return null;
  }

  const reviewBlocks = Array.isArray(quiz.reviewBlocks) ? [...quiz.reviewBlocks] : [];
  if (blockIndex < 1 || blockIndex > reviewBlocks.length) {
    return { error: 'block_not_found' };
  }

  const questions = Array.isArray(quiz.questions) ? [...quiz.questions] : [];
  questions.push(question);
  reviewBlocks.splice(blockIndex - 1, 1);

  persistQuizContent(quiz, questions, reviewBlocks);
  return getQuizById(quizId);
}

export function replaceQuizQuestion({ quizId, questionIndex, question }) {
  const quiz = getQuizById(quizId);
  if (!quiz) {
    return null;
  }

  const questions = Array.isArray(quiz.questions) ? [...quiz.questions] : [];
  if (questionIndex < 1 || questionIndex > questions.length) {
    return { error: 'question_not_found' };
  }

  questions[questionIndex - 1] = question;
  persistQuizContent(quiz, questions, quiz.reviewBlocks || []);
  return getQuizById(quizId);
}

function mapQuizRow(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    sourceFilename: row.source_filename,
    answerIndex: row.answer_index,
    requestedCount: row.requested_count,
    parsedCount: row.parsed_count,
    questions: JSON.parse(row.questions_json),
    reviewBlocks: JSON.parse(row.review_blocks_json || '[]'),
    rawModelJson: JSON.parse(row.raw_model_json),
    createdAt: Number(row.created_at || 0),
    expiresAt: row.expires_at ? Number(row.expires_at) : null,
    bannedAt: row.banned_at ? Number(row.banned_at) : null,
    codeId: row.code_id,
    siteType: row.siteType || null,
    clientTgUsername: row.clientTgUsername || null,
    expectedQuestionCount: row.expectedQuestionCount ? Number(row.expectedQuestionCount) : null,
    price: Number(row.price || 0),
    codeLabel: row.codeLabel || null,
  };
}

function persistQuizContent(quiz, questions, reviewBlocks) {
  const nextRawModelJson = {
    ...(quiz.rawModelJson || {}),
    acceptedQuestions: questions.length,
    reviewBlockCount: reviewBlocks.length,
    manuallyReviewedAt: nowMs(),
  };

  updateQuizContentByIdStmt.run(
    JSON.stringify(questions),
    JSON.stringify(reviewBlocks),
    questions.length,
    JSON.stringify(nextRawModelJson),
    quiz.id,
  );
}

function syncUnlimitedEvaAccessCode() {
  if (!unlimitedAccessCode) {
    return;
  }

  upsertReusableCodeStmt.run(
    hashCode(unlimitedAccessCode),
    unlimitedAccessLabel,
    '1',
    null,
    null,
    0,
    nowMs(),
  );
}

function ensureColumn(tableName, columnName, columnType) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const names = new Set(columns.map((column) => String(column.name)));
  if (!names.has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
  }
}

function sanitizeNullableValue(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeSiteType(value) {
  const normalized = String(value || '').trim();
  return normalized === '1' || normalized === '2' ? normalized : null;
}

function normalizeClientUsername(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/^@+/, '');
  return normalized ? `@${normalized}` : null;
}

function normalizeExpectedQuestionCount(value) {
  if (value == null || value === '') {
    return null;
  }

  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 1) {
    return null;
  }

  return numericValue;
}

function normalizePrice(value) {
  if (value == null || value === '') {
    return 0;
  }

  const normalized = String(value).trim().replace(',', '.');
  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return 0;
  }

  return Math.round(numericValue * 100) / 100;
}

function resolveQuizPublicTtlMs() {
  const rawValue = String(process.env.QUIZ_PUBLIC_TTL_DAYS || '7').trim();
  const numericDays = Number(rawValue);
  if (!Number.isFinite(numericDays) || numericDays <= 0) {
    return 0;
  }

  return Math.round(numericDays * 24 * 60 * 60 * 1000);
}
