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

fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS access_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code_hash TEXT NOT NULL UNIQUE,
    label TEXT,
    created_at INTEGER NOT NULL,
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
    raw_model_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    code_id INTEGER NOT NULL,
    FOREIGN KEY(code_id) REFERENCES access_codes(id)
  );

  CREATE INDEX IF NOT EXISTS idx_quizzes_slug ON quizzes(slug);
  CREATE INDEX IF NOT EXISTS idx_access_codes_reservation_token ON access_codes(reservation_token);
`);

const insertCodeStmt = db.prepare(`
  INSERT INTO access_codes (code_hash, label, created_at)
  VALUES (?, ?, ?)
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
    AND used_at IS NULL
    AND reservation_token IS NULL
`);

const selectReservedCodeStmt = db.prepare(`
  SELECT id
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
  SELECT id
  FROM access_codes
  WHERE reservation_token = ?
    AND used_at IS NULL
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
    raw_model_json,
    created_at,
    code_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const markCodeUsedStmt = db.prepare(`
  UPDATE access_codes
  SET used_at = ?, used_by_quiz_id = ?, reserved_at = NULL, reservation_token = NULL
  WHERE id = ?
`);

const getQuizBySlugStmt = db.prepare(`
  SELECT *
  FROM quizzes
  WHERE slug = ?
`);

export function getDbMeta() {
  return {
    dataDir,
    dbPath,
  };
}

export function createAccessCodes(count = 1, label = null) {
  const total = Math.max(1, Math.min(100, Number(count) || 1));
  const createdAt = nowMs();
  const codes = [];

  const tx = db.transaction(() => {
    while (codes.length < total) {
      const code = generateAccessCode();
      const codeHash = hashCode(code);

      try {
        insertCodeStmt.run(codeHash, label, createdAt);
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

export function finalizeQuizFromReservation({
  reservationToken,
  title,
  sourceFilename,
  answerIndex,
  requestedCount,
  questions,
  rawModelJson,
}) {
  const createdAt = nowMs();

  const tx = db.transaction(() => {
    const codeRow = findCodeByTokenStmt.get(reservationToken);
    if (!codeRow) {
      throw new Error('Код больше не доступен. Попробуйте создать новый.');
    }

    let slug = generateSlug();
    while (getQuizBySlugStmt.get(slug)) {
      slug = generateSlug();
    }

    const quizInsert = insertQuizStmt.run(
      slug,
      title,
      sourceFilename,
      answerIndex,
      requestedCount,
      questions.length,
      JSON.stringify(questions),
      JSON.stringify(rawModelJson),
      createdAt,
      codeRow.id,
    );

    markCodeUsedStmt.run(createdAt, quizInsert.lastInsertRowid, codeRow.id);

    return {
      id: Number(quizInsert.lastInsertRowid),
      slug,
    };
  });

  return tx();
}

export function getQuizBySlug(slug) {
  const row = getQuizBySlugStmt.get(slug);
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    sourceFilename: row.source_filename,
    answerIndex: row.answer_index,
    requestedCount: row.requested_count,
    parsedCount: row.parsed_count,
    questions: JSON.parse(row.questions_json),
    rawModelJson: JSON.parse(row.raw_model_json),
    createdAt: row.created_at,
    codeId: row.code_id,
  };
}

