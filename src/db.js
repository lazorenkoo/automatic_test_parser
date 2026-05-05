import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');

const unlimitedAccessCode = normalizeCode(process.env.UNLIMITED_EVA_ACCESS_CODE || '');
const internalAiFreeCode = '__AI_FREE_INTERNAL__';
const internalAiFreeLabel = 'AI-NO-CODE';
const unlimitedAccessLabel = 'ЕВА';

db.exec(`
  CREATE TABLE IF NOT EXISTS access_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code_hash TEXT NOT NULL UNIQUE,
    label TEXT,
    site_type TEXT,
    client_tg_user_id INTEGER,
    client_tg_username TEXT,
    expected_question_count INTEGER,
    remaining_question_count INTEGER,
    consumed_question_count INTEGER NOT NULL DEFAULT 0,
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
    course_number INTEGER NOT NULL DEFAULT 0,
    client_tg_username TEXT,
    source_filename TEXT NOT NULL,
    answer_index INTEGER NOT NULL,
    requested_count INTEGER NOT NULL,
    parsed_count INTEGER NOT NULL,
    questions_json TEXT NOT NULL,
    review_blocks_json TEXT NOT NULL DEFAULT '[]',
    raw_model_json TEXT NOT NULL,
    creator_snapshot_json TEXT NOT NULL DEFAULT '{}',
    source_upload_path TEXT,
    source_upload_name TEXT,
    answer_upload_path TEXT,
    answer_upload_name TEXT,
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
    course_number INTEGER NOT NULL DEFAULT 0,
    source_filename TEXT NOT NULL,
    answer_index INTEGER NOT NULL,
    requested_count INTEGER NOT NULL,
    parsed_count INTEGER NOT NULL,
    questions_json TEXT NOT NULL,
    review_blocks_json TEXT NOT NULL DEFAULT '[]',
    raw_model_json TEXT NOT NULL,
    source_upload_path TEXT,
    source_upload_name TEXT,
    answer_upload_path TEXT,
    answer_upload_name TEXT,
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

  CREATE TABLE IF NOT EXISTS quiz_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id INTEGER NOT NULL,
    note TEXT,
    reporter_snapshot_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    FOREIGN KEY(quiz_id) REFERENCES quizzes(id)
  );

  CREATE TABLE IF NOT EXISTS quiz_corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id INTEGER NOT NULL,
    question_index INTEGER NOT NULL,
    visible_question_number INTEGER,
    configured_option_count INTEGER,
    shuffle_questions INTEGER NOT NULL DEFAULT 0,
    shuffled_option_order_json TEXT NOT NULL DEFAULT '[]',
    original_question_text TEXT NOT NULL,
    edited_question_text TEXT NOT NULL,
    original_options_json TEXT NOT NULL,
    edited_options_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(quiz_id) REFERENCES quizzes(id)
  );

  CREATE TABLE IF NOT EXISTS upload_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    note TEXT,
    source_upload_path TEXT,
    source_upload_name TEXT,
    answer_upload_path TEXT,
    answer_upload_name TEXT,
    reporter_snapshot_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payment_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_user_id INTEGER NOT NULL,
    tg_username TEXT,
    target_code TEXT NOT NULL,
    question_count INTEGER NOT NULL,
    amount_minor INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    confirmed_at INTEGER,
    matched_statement_id TEXT UNIQUE,
    cancel_reason TEXT
  );

  CREATE TABLE IF NOT EXISTS ai_request_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    request_kind TEXT NOT NULL,
    model TEXT,
    status TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_device_bans (
    browser_id TEXT PRIMARY KEY,
    reason TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS site_device_bans (
    device_id TEXT PRIMARY KEY,
    reason TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS site_device_warnings (
    device_id TEXT PRIMARY KEY,
    reason TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS device_client_links (
    browser_id TEXT PRIMARY KEY,
    client_tg_username TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_quizzes_slug ON quizzes(slug);
  CREATE INDEX IF NOT EXISTS idx_access_codes_reservation_token ON access_codes(reservation_token);
  CREATE INDEX IF NOT EXISTS idx_quiz_drafts_token ON quiz_drafts(draft_token);
  CREATE INDEX IF NOT EXISTS idx_quiz_drafts_created_at ON quiz_drafts(created_at);
  CREATE INDEX IF NOT EXISTS idx_quiz_devices_quiz_id ON quiz_devices(quiz_id);
  CREATE INDEX IF NOT EXISTS idx_quiz_reports_quiz_id ON quiz_reports(quiz_id);
  CREATE INDEX IF NOT EXISTS idx_quiz_reports_created_at ON quiz_reports(created_at);
  CREATE INDEX IF NOT EXISTS idx_quiz_corrections_quiz_id ON quiz_corrections(quiz_id);
  CREATE INDEX IF NOT EXISTS idx_quiz_corrections_created_at ON quiz_corrections(created_at);
  CREATE INDEX IF NOT EXISTS idx_upload_reports_created_at ON upload_reports(created_at);
  CREATE INDEX IF NOT EXISTS idx_ai_request_logs_created_at ON ai_request_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_payment_sessions_user_created_at ON payment_sessions(tg_user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_payment_sessions_status_expires_at ON payment_sessions(status, expires_at);
  CREATE INDEX IF NOT EXISTS idx_device_client_links_updated_at ON device_client_links(updated_at DESC);
`);

ensureColumn('access_codes', 'site_type', 'TEXT');
ensureColumn('access_codes', 'client_tg_user_id', 'INTEGER');
ensureColumn('access_codes', 'client_tg_username', 'TEXT');
ensureColumn('access_codes', 'expected_question_count', 'INTEGER');
ensureColumn('access_codes', 'remaining_question_count', 'INTEGER');
ensureColumn('access_codes', 'consumed_question_count', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('access_codes', 'price', 'REAL NOT NULL DEFAULT 0');
ensureColumn('access_codes', 'is_reusable', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('access_codes', 'revoked_at', 'INTEGER');
ensureColumn('quizzes', 'review_blocks_json', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('quiz_drafts', 'review_blocks_json', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('quizzes', 'expires_at', 'INTEGER');
ensureColumn('quizzes', 'banned_at', 'INTEGER');
ensureColumn('quizzes', 'course_number', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('quizzes', 'client_tg_username', 'TEXT');
ensureColumn('quiz_drafts', 'course_number', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('quizzes', 'creator_snapshot_json', "TEXT NOT NULL DEFAULT '{}'");
ensureColumn('quizzes', 'source_upload_path', 'TEXT');
ensureColumn('quizzes', 'source_upload_name', 'TEXT');
ensureColumn('quizzes', 'answer_upload_path', 'TEXT');
ensureColumn('quizzes', 'answer_upload_name', 'TEXT');
ensureColumn('quiz_drafts', 'source_upload_path', 'TEXT');
ensureColumn('quiz_drafts', 'source_upload_name', 'TEXT');
ensureColumn('quiz_drafts', 'answer_upload_path', 'TEXT');
ensureColumn('quiz_drafts', 'answer_upload_name', 'TEXT');
ensureColumn('quiz_corrections', 'visible_question_number', 'INTEGER');
ensureColumn('quiz_corrections', 'configured_option_count', 'INTEGER');
ensureColumn('quiz_corrections', 'shuffle_questions', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('quiz_corrections', 'shuffled_option_order_json', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('quiz_corrections', 'original_question_text', "TEXT NOT NULL DEFAULT ''");
ensureColumn('quiz_corrections', 'edited_question_text', "TEXT NOT NULL DEFAULT ''");
ensureColumn('quiz_corrections', 'original_options_json', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('quiz_corrections', 'edited_options_json', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('ai_request_logs', 'title', 'TEXT');
ensureColumn('ai_request_logs', 'source_filename', 'TEXT');
ensureColumn('ai_request_logs', 'browser_id', 'TEXT');
ensureColumn('ai_request_logs', 'fingerprint', 'TEXT');
ensureColumn('ai_request_logs', 'request_ip', 'TEXT');
ensureColumn('ai_request_logs', 'request_user_agent', 'TEXT');

const insertCodeStmt = db.prepare(`
  INSERT INTO access_codes (
    code_hash,
    label,
    site_type,
    client_tg_user_id,
    client_tg_username,
    expected_question_count,
    remaining_question_count,
    consumed_question_count,
    price,
    is_reusable,
    created_at,
    revoked_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
`);

const upsertReusableCodeStmt = db.prepare(`
  INSERT INTO access_codes (
    code_hash,
    label,
    site_type,
    client_tg_user_id,
    client_tg_username,
    expected_question_count,
    remaining_question_count,
    consumed_question_count,
    price,
    is_reusable,
    created_at,
    reserved_at,
    reservation_token,
    used_at,
    used_by_quiz_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, NULL, NULL, NULL)
  ON CONFLICT(code_hash) DO UPDATE SET
    label = excluded.label,
    site_type = excluded.site_type,
    client_tg_user_id = excluded.client_tg_user_id,
    client_tg_username = excluded.client_tg_username,
    expected_question_count = excluded.expected_question_count,
    remaining_question_count = excluded.remaining_question_count,
    consumed_question_count = excluded.consumed_question_count,
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
    client_tg_user_id AS clientTgUserId,
    client_tg_username AS clientTgUsername,
    expected_question_count AS expectedQuestionCount,
    remaining_question_count AS remainingQuestionCount,
    consumed_question_count AS consumedQuestionCount,
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
    client_tg_user_id AS clientTgUserId,
    client_tg_username AS clientTgUsername,
    expected_question_count AS expectedQuestionCount,
    remaining_question_count AS remainingQuestionCount,
    consumed_question_count AS consumedQuestionCount,
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
    client_tg_user_id AS clientTgUserId,
    client_tg_username AS clientTgUsername,
    expected_question_count AS expectedQuestionCount,
    remaining_question_count AS remainingQuestionCount,
    consumed_question_count AS consumedQuestionCount,
    price,
    is_reusable AS isReusable,
    revoked_at AS revokedAt,
    used_at AS usedAt,
    used_by_quiz_id AS usedByQuizId
  FROM access_codes
  WHERE code_hash = ?
`);

const upsertAppSettingStmt = db.prepare(`
  INSERT INTO app_settings (
    key,
    value,
    updated_at
  ) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = excluded.updated_at
`);

const getAppSettingStmt = db.prepare(`
  SELECT value
  FROM app_settings
  WHERE key = ?
`);

const insertAiRequestLogStmt = db.prepare(`
  INSERT INTO ai_request_logs (
    created_at,
    request_kind,
    model,
    status,
    title,
    source_filename,
    browser_id,
    fingerprint,
    request_ip,
    request_user_agent
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const countAiRequestsBetweenStmt = db.prepare(`
  SELECT COUNT(*) AS total
  FROM ai_request_logs
  WHERE created_at >= ?
    AND created_at < ?
    AND status = 'sent'
`);

const listAiRequestLogsStmt = db.prepare(`
  SELECT
    id,
    created_at AS createdAt,
    request_kind AS requestKind,
    model,
    status,
    title,
    source_filename AS sourceFilename,
    browser_id AS browserId,
    fingerprint,
    request_ip AS requestIp,
    request_user_agent AS requestUserAgent
  FROM ai_request_logs
  ORDER BY created_at DESC
  LIMIT ?
`);

const getLastAiPrepareAcceptedByBrowserStmt = db.prepare(`
  SELECT
    created_at AS createdAt,
    title,
    source_filename AS sourceFilename
  FROM ai_request_logs
  WHERE browser_id = ?
    AND request_kind = 'prepare-started'
    AND status = 'accepted'
  ORDER BY created_at DESC
  LIMIT 1
`);

const upsertAiDeviceBanStmt = db.prepare(`
  INSERT INTO ai_device_bans (
    browser_id,
    reason,
    created_at
  ) VALUES (?, ?, ?)
  ON CONFLICT(browser_id) DO UPDATE SET
    reason = excluded.reason,
    created_at = excluded.created_at
`);

const getAiDeviceBanStmt = db.prepare(`
  SELECT
    browser_id AS browserId,
    reason,
    created_at AS createdAt
  FROM ai_device_bans
  WHERE browser_id = ?
`);

const deleteAiDeviceBanStmt = db.prepare(`
  DELETE FROM ai_device_bans
  WHERE browser_id = ?
`);

const listAiDeviceBansStmt = db.prepare(`
  SELECT
    browser_id AS browserId,
    reason,
    created_at AS createdAt
  FROM ai_device_bans
  ORDER BY created_at DESC
  LIMIT ?
`);

const upsertSiteDeviceBanStmt = db.prepare(`
  INSERT INTO site_device_bans (
    device_id,
    reason,
    created_at,
    expires_at
  ) VALUES (?, ?, ?, ?)
  ON CONFLICT(device_id) DO UPDATE SET
    reason = excluded.reason,
    created_at = excluded.created_at,
    expires_at = excluded.expires_at
`);

const getSiteDeviceBanStmt = db.prepare(`
  SELECT
    device_id AS deviceId,
    reason,
    created_at AS createdAt,
    expires_at AS expiresAt
  FROM site_device_bans
  WHERE device_id = ?
`);

const deleteSiteDeviceBanStmt = db.prepare(`
  DELETE FROM site_device_bans
  WHERE device_id = ?
`);

const deleteExpiredSiteDeviceBansStmt = db.prepare(`
  DELETE FROM site_device_bans
  WHERE expires_at <= ?
`);

const listSiteDeviceBansStmt = db.prepare(`
  SELECT
    device_id AS deviceId,
    reason,
    created_at AS createdAt,
    expires_at AS expiresAt
  FROM site_device_bans
  WHERE expires_at > ?
  ORDER BY expires_at DESC, created_at DESC
  LIMIT ?
`);

const upsertSiteDeviceWarningStmt = db.prepare(`
  INSERT INTO site_device_warnings (
    device_id,
    reason,
    created_at
  ) VALUES (?, ?, ?)
  ON CONFLICT(device_id) DO UPDATE SET
    reason = excluded.reason,
    created_at = excluded.created_at
`);

const getSiteDeviceWarningStmt = db.prepare(`
  SELECT
    device_id AS deviceId,
    reason,
    created_at AS createdAt
  FROM site_device_warnings
  WHERE device_id = ?
`);

const deleteSiteDeviceWarningStmt = db.prepare(`
  DELETE FROM site_device_warnings
  WHERE device_id = ?
`);

const listSiteDeviceWarningsStmt = db.prepare(`
  SELECT
    device_id AS deviceId,
    reason,
    created_at AS createdAt
  FROM site_device_warnings
  ORDER BY created_at DESC
  LIMIT ?
`);

const upsertDeviceClientLinkStmt = db.prepare(`
  INSERT INTO device_client_links (
    browser_id,
    client_tg_username,
    updated_at
  ) VALUES (?, ?, ?)
  ON CONFLICT(browser_id) DO UPDATE SET
    client_tg_username = excluded.client_tg_username,
    updated_at = excluded.updated_at
`);

const getDeviceClientLinkStmt = db.prepare(`
  SELECT
    browser_id AS browserId,
    client_tg_username AS clientTgUsername,
    updated_at AS updatedAt
  FROM device_client_links
  WHERE browser_id = ?
`);

const insertQuizStmt = db.prepare(`
  INSERT INTO quizzes (
    slug,
    title,
    course_number,
    client_tg_username,
    source_filename,
    answer_index,
    requested_count,
    parsed_count,
    questions_json,
    review_blocks_json,
    raw_model_json,
    creator_snapshot_json,
    source_upload_path,
    source_upload_name,
    answer_upload_path,
    answer_upload_name,
    created_at,
    expires_at,
    code_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

const consumeAccessCodeQuestionsStmt = db.prepare(`
  UPDATE access_codes
  SET
    remaining_question_count = remaining_question_count - ?,
    consumed_question_count = consumed_question_count + ?
  WHERE code_hash = ?
    AND revoked_at IS NULL
    AND remaining_question_count IS NOT NULL
    AND remaining_question_count >= ?
`);

const refundAccessCodeQuestionsStmt = db.prepare(`
  UPDATE access_codes
  SET
    remaining_question_count = remaining_question_count + ?,
    consumed_question_count = CASE
      WHEN consumed_question_count >= ? THEN consumed_question_count - ?
      ELSE 0
    END
  WHERE id = ?
    AND revoked_at IS NULL
    AND remaining_question_count IS NOT NULL
`);

const topUpAccessCodeStmt = db.prepare(`
  UPDATE access_codes
  SET
    expected_question_count = COALESCE(expected_question_count, 0) + ?,
    remaining_question_count = COALESCE(remaining_question_count, 0) + ?
  WHERE code_hash = ?
    AND revoked_at IS NULL
`);

const insertClientEmptyCodeStmt = db.prepare(`
  INSERT INTO access_codes (
    code_hash,
    label,
    site_type,
    client_tg_user_id,
    client_tg_username,
    expected_question_count,
    remaining_question_count,
    consumed_question_count,
    price,
    is_reusable,
    created_at,
    revoked_at
  ) VALUES (?, ?, NULL, ?, ?, 0, 0, 0, 0, 1, ?, NULL)
`);

const listAccessCodesByOwnerStmt = db.prepare(`
  SELECT
    id,
    label,
    site_type AS siteType,
    client_tg_user_id AS clientTgUserId,
    client_tg_username AS clientTgUsername,
    expected_question_count AS expectedQuestionCount,
    remaining_question_count AS remainingQuestionCount,
    consumed_question_count AS consumedQuestionCount,
    price,
    is_reusable AS isReusable,
    revoked_at AS revokedAt,
    used_at AS usedAt,
    used_by_quiz_id AS usedByQuizId
  FROM access_codes
  WHERE revoked_at IS NULL
    AND (
      client_tg_user_id = ?
      OR (
        client_tg_user_id IS NULL
        AND ? IS NOT NULL
        AND client_tg_username = ?
      )
    )
  ORDER BY created_at DESC, id DESC
`);

const listActiveAiAccessCodesStmt = db.prepare(`
  SELECT
    id,
    label,
    site_type AS siteType,
    client_tg_user_id AS clientTgUserId,
    client_tg_username AS clientTgUsername,
    expected_question_count AS expectedQuestionCount,
    remaining_question_count AS remainingQuestionCount,
    consumed_question_count AS consumedQuestionCount,
    price,
    is_reusable AS isReusable,
    revoked_at AS revokedAt,
    used_at AS usedAt,
    used_by_quiz_id AS usedByQuizId,
    created_at AS createdAt
  FROM access_codes
  WHERE revoked_at IS NULL
    AND site_type IS NULL
    AND code_hash != ?
    AND (
      remaining_question_count IS NULL
      OR remaining_question_count > 0
    )
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`);

const getLatestPaymentSessionByUserStmt = db.prepare(`
  SELECT
    id,
    tg_user_id AS tgUserId,
    tg_username AS tgUsername,
    target_code AS targetCode,
    question_count AS questionCount,
    amount_minor AS amountMinor,
    status,
    created_at AS createdAt,
    expires_at AS expiresAt,
    confirmed_at AS confirmedAt,
    matched_statement_id AS matchedStatementId,
    cancel_reason AS cancelReason
  FROM payment_sessions
  WHERE tg_user_id = ?
  ORDER BY created_at DESC, id DESC
  LIMIT 1
`);

const getActivePaymentSessionStmt = db.prepare(`
  SELECT
    id,
    tg_user_id AS tgUserId,
    tg_username AS tgUsername,
    target_code AS targetCode,
    question_count AS questionCount,
    amount_minor AS amountMinor,
    status,
    created_at AS createdAt,
    expires_at AS expiresAt,
    confirmed_at AS confirmedAt,
    matched_statement_id AS matchedStatementId,
    cancel_reason AS cancelReason
  FROM payment_sessions
  WHERE status = 'pending'
    AND expires_at > ?
  ORDER BY created_at ASC, id ASC
  LIMIT 1
`);

const getActivePaymentSessionByUserStmt = db.prepare(`
  SELECT
    id,
    tg_user_id AS tgUserId,
    tg_username AS tgUsername,
    target_code AS targetCode,
    question_count AS questionCount,
    amount_minor AS amountMinor,
    status,
    created_at AS createdAt,
    expires_at AS expiresAt,
    confirmed_at AS confirmedAt,
    matched_statement_id AS matchedStatementId,
    cancel_reason AS cancelReason
  FROM payment_sessions
  WHERE tg_user_id = ?
    AND status = 'pending'
    AND expires_at > ?
  ORDER BY created_at DESC, id DESC
  LIMIT 1
`);

const insertPaymentSessionStmt = db.prepare(`
  INSERT INTO payment_sessions (
    tg_user_id,
    tg_username,
    target_code,
    question_count,
    amount_minor,
    status,
    created_at,
    expires_at,
    confirmed_at,
    matched_statement_id,
    cancel_reason
  ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL)
`);

const expirePaymentSessionsStmt = db.prepare(`
  UPDATE payment_sessions
  SET status = 'expired', cancel_reason = 'timeout'
  WHERE status = 'pending'
    AND expires_at <= ?
`);

const cancelPaymentSessionByIdStmt = db.prepare(`
  UPDATE payment_sessions
  SET status = 'cancelled', cancel_reason = ?
  WHERE id = ?
    AND status = 'pending'
`);

const getPaymentSessionByIdStmt = db.prepare(`
  SELECT
    id,
    tg_user_id AS tgUserId,
    tg_username AS tgUsername,
    target_code AS targetCode,
    question_count AS questionCount,
    amount_minor AS amountMinor,
    status,
    created_at AS createdAt,
    expires_at AS expiresAt,
    confirmed_at AS confirmedAt,
    matched_statement_id AS matchedStatementId,
    cancel_reason AS cancelReason
  FROM payment_sessions
  WHERE id = ?
`);

const completePaymentSessionStmt = db.prepare(`
  UPDATE payment_sessions
  SET
    status = 'confirmed',
    confirmed_at = ?,
    matched_statement_id = ?,
    cancel_reason = NULL
  WHERE id = ?
    AND status = 'pending'
    AND matched_statement_id IS NULL
`);

const unlinkCodeFromQuizStmt = db.prepare(`
  UPDATE access_codes
  SET used_by_quiz_id = NULL
  WHERE used_by_quiz_id = ?
`);

const getQuizBySlugStmt = db.prepare(`
  SELECT
    q.*,
    c.site_type AS siteType,
    COALESCE(q.client_tg_username, c.client_tg_username) AS clientTgUsername,
    c.expected_question_count AS expectedQuestionCount,
    c.remaining_question_count AS remainingQuestionCount,
    c.consumed_question_count AS consumedQuestionCount,
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
    COALESCE(q.client_tg_username, c.client_tg_username) AS clientTgUsername,
    c.expected_question_count AS expectedQuestionCount,
    c.remaining_question_count AS remainingQuestionCount,
    c.consumed_question_count AS consumedQuestionCount,
    c.price AS price,
    c.label AS codeLabel
  FROM quizzes q
  LEFT JOIN access_codes c ON c.id = q.code_id
  WHERE q.id = ?
`);

const getQuizQuestionStatsByRangeStmt = db.prepare(`
  SELECT
    COUNT(*) AS quizCount,
    COALESCE(SUM(q.parsed_count), 0) AS totalQuestions,
    MIN(q.id) AS firstQuizId,
    MAX(q.id) AS lastQuizId
  FROM quizzes q
  WHERE q.id BETWEEN ? AND ?
`);

const clearExpiredDraftsStmt = db.prepare(`
  DELETE FROM quiz_drafts
  WHERE created_at < ?
`);

const insertDraftStmt = db.prepare(`
  INSERT INTO quiz_drafts (
    draft_token,
    title,
    course_number,
    source_filename,
    answer_index,
    requested_count,
    parsed_count,
    questions_json,
    review_blocks_json,
    raw_model_json,
    source_upload_path,
    source_upload_name,
    answer_upload_path,
    answer_upload_name,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

const updateDraftUploadsByTokenStmt = db.prepare(`
  UPDATE quiz_drafts
  SET
    source_upload_path = ?,
    source_upload_name = ?,
    answer_upload_path = ?,
    answer_upload_name = ?
  WHERE draft_token = ?
`);

const updateDraftContentByTokenStmt = db.prepare(`
  UPDATE quiz_drafts
  SET
    parsed_count = ?,
    questions_json = ?,
    review_blocks_json = ?,
    raw_model_json = ?
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
    q.course_number AS courseNumber,
    q.creator_snapshot_json AS creatorSnapshotJson,
    q.source_filename AS sourceFilename,
    q.raw_model_json AS rawModelJson,
    q.parsed_count AS parsedCount,
    q.requested_count AS requestedCount,
    q.created_at AS createdAt,
    q.expires_at AS expiresAt,
    q.banned_at AS bannedAt,
    c.label AS codeLabel,
    c.site_type AS siteType,
    COALESCE(q.client_tg_username, c.client_tg_username) AS clientTgUsername,
    c.expected_question_count AS expectedQuestionCount,
    c.remaining_question_count AS remainingQuestionCount,
    c.consumed_question_count AS consumedQuestionCount,
    c.price AS price,
    COUNT(d.id) AS deviceCount,
    MAX(d.last_seen_at) AS lastSeenAt
  FROM quizzes q
  LEFT JOIN access_codes c ON c.id = q.code_id
  LEFT JOIN quiz_devices d ON d.quiz_id = q.id
  GROUP BY q.id
  ORDER BY q.created_at DESC
`);

const listQuizLinksStmt = db.prepare(`
  SELECT
    q.id,
    q.slug,
    q.title,
    q.course_number AS courseNumber,
    q.client_tg_username AS quizClientTgUsername,
    q.creator_snapshot_json AS creatorSnapshotJson,
    q.created_at AS createdAt,
    q.expires_at AS expiresAt,
    q.banned_at AS bannedAt,
    COALESCE(q.client_tg_username, c.client_tg_username) AS clientTgUsername
  FROM quizzes q
  LEFT JOIN access_codes c ON c.id = q.code_id
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

const deleteQuizReportsByQuizIdStmt = db.prepare(`
  DELETE FROM quiz_reports
  WHERE quiz_id = ?
`);

const deleteQuizCorrectionsByQuizIdStmt = db.prepare(`
  DELETE FROM quiz_corrections
  WHERE quiz_id = ?
`);

const deleteQuizByIdStmt = db.prepare(`
  DELETE FROM quizzes
  WHERE id = ?
`);

const accountingSummaryStmt = db.prepare(`
  SELECT
    COUNT(*) FILTER (WHERE COALESCE(consumed_question_count, 0) > 0) AS usedCodeCount,
    COALESCE(SUM(consumed_question_count), 0) AS consumedQuestionCount,
    COALESCE(SUM(price), 0) AS totalAmount
  FROM access_codes
`);

const insertQuizReportStmt = db.prepare(`
  INSERT INTO quiz_reports (
    quiz_id,
    note,
    reporter_snapshot_json,
    created_at
  ) VALUES (?, ?, ?, ?)
`);

const listQuizReportsStmt = db.prepare(`
  SELECT
    r.id,
    r.quiz_id AS quizId,
    r.note,
    r.reporter_snapshot_json AS reporterSnapshotJson,
    r.created_at AS createdAt,
    q.slug AS quizSlug,
    q.title AS quizTitle,
    q.source_upload_path AS sourceUploadPath,
    q.source_upload_name AS sourceUploadName,
    q.answer_upload_path AS answerUploadPath,
    q.answer_upload_name AS answerUploadName
  FROM quiz_reports r
  INNER JOIN quizzes q ON q.id = r.quiz_id
  ORDER BY r.created_at DESC, r.id DESC
  LIMIT ?
`);

const getQuizReportByIdStmt = db.prepare(`
  SELECT
    r.id,
    r.quiz_id AS quizId,
    r.note,
    r.reporter_snapshot_json AS reporterSnapshotJson,
    r.created_at AS createdAt,
    q.slug AS quizSlug,
    q.title AS quizTitle,
    q.source_upload_path AS sourceUploadPath,
    q.source_upload_name AS sourceUploadName,
    q.answer_upload_path AS answerUploadPath,
    q.answer_upload_name AS answerUploadName
  FROM quiz_reports r
  INNER JOIN quizzes q ON q.id = r.quiz_id
  WHERE r.id = ?
`);

const insertQuizCorrectionStmt = db.prepare(`
  INSERT INTO quiz_corrections (
    quiz_id,
    question_index,
    visible_question_number,
    configured_option_count,
    shuffle_questions,
    shuffled_option_order_json,
    original_question_text,
    edited_question_text,
    original_options_json,
    edited_options_json,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const trimQuizCorrectionsStmt = db.prepare(`
  DELETE FROM quiz_corrections
  WHERE id NOT IN (
    SELECT id
    FROM quiz_corrections
    ORDER BY created_at DESC, id DESC
    LIMIT 100
  )
`);

const listQuizCorrectionsStmt = db.prepare(`
  SELECT
    c.id,
    c.quiz_id AS quizId,
    q.slug AS quizSlug,
    q.title AS quizTitle,
    c.question_index AS questionIndex,
    c.visible_question_number AS visibleQuestionNumber,
    c.configured_option_count AS configuredOptionCount,
    c.shuffle_questions AS shuffleQuestions,
    c.shuffled_option_order_json AS shuffledOptionOrderJson,
    c.original_question_text AS originalQuestionText,
    c.edited_question_text AS editedQuestionText,
    c.original_options_json AS originalOptionsJson,
    c.edited_options_json AS editedOptionsJson,
    c.created_at AS createdAt
  FROM quiz_corrections c
  LEFT JOIN quizzes q ON q.id = c.quiz_id
  ORDER BY c.created_at DESC, c.id DESC
  LIMIT ?
`);

const getQuizCorrectionByIdStmt = db.prepare(`
  SELECT
    c.id,
    c.quiz_id AS quizId,
    q.slug AS quizSlug,
    q.title AS quizTitle,
    c.question_index AS questionIndex,
    c.visible_question_number AS visibleQuestionNumber,
    c.configured_option_count AS configuredOptionCount,
    c.shuffle_questions AS shuffleQuestions,
    c.shuffled_option_order_json AS shuffledOptionOrderJson,
    c.original_question_text AS originalQuestionText,
    c.edited_question_text AS editedQuestionText,
    c.original_options_json AS originalOptionsJson,
    c.edited_options_json AS editedOptionsJson,
    c.created_at AS createdAt
  FROM quiz_corrections c
  LEFT JOIN quizzes q ON q.id = c.quiz_id
  WHERE c.id = ?
`);

const listQuizCorrectionsByQuizIdStmt = db.prepare(`
  SELECT
    id,
    quiz_id AS quizId,
    question_index AS questionIndex,
    visible_question_number AS visibleQuestionNumber,
    configured_option_count AS configuredOptionCount,
    shuffle_questions AS shuffleQuestions,
    shuffled_option_order_json AS shuffledOptionOrderJson,
    original_question_text AS originalQuestionText,
    edited_question_text AS editedQuestionText,
    original_options_json AS originalOptionsJson,
    edited_options_json AS editedOptionsJson,
    created_at AS createdAt
  FROM quiz_corrections
  WHERE quiz_id = ?
  ORDER BY created_at DESC, id DESC
  LIMIT 100
`);

const insertUploadReportStmt = db.prepare(`
  INSERT INTO upload_reports (
    title,
    note,
    source_upload_path,
    source_upload_name,
    answer_upload_path,
    answer_upload_name,
    reporter_snapshot_json,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const listUploadReportsStmt = db.prepare(`
  SELECT
    id,
    title,
    note,
    source_upload_path AS sourceUploadPath,
    source_upload_name AS sourceUploadName,
    answer_upload_path AS answerUploadPath,
    answer_upload_name AS answerUploadName,
    reporter_snapshot_json AS reporterSnapshotJson,
    created_at AS createdAt
  FROM upload_reports
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`);

const getUploadReportByIdStmt = db.prepare(`
  SELECT
    id,
    title,
    note,
    source_upload_path AS sourceUploadPath,
    source_upload_name AS sourceUploadName,
    answer_upload_path AS answerUploadPath,
    answer_upload_name AS answerUploadName,
    reporter_snapshot_json AS reporterSnapshotJson,
    created_at AS createdAt
  FROM upload_reports
  WHERE id = ?
`);

const deleteQuizReportByIdStmt = db.prepare(`
  DELETE FROM quiz_reports
  WHERE id = ?
`);

const deleteUploadReportByIdStmt = db.prepare(`
  DELETE FROM upload_reports
  WHERE id = ?
`);

syncUnlimitedEvaAccessCode();
syncInternalAiFreeCode();
syncLegacyAccessCodeBalances();
ensureDefaultAiSettings();

export function getDbMeta() {
  return {
    dataDir,
    dbPath,
    quizPublicTtlMs,
  };
}

export function getAiRuntimeSettings() {
  return {
    enabled: readBooleanSetting('ai.enabled', true),
    requireCode: readBooleanSetting('ai.require_code', false),
    dailyLimit: readIntegerSetting('ai.daily_limit', 0),
    mode: readAiModeSetting('ai.mode', 'double'),
  };
}

export function updateAiRuntimeSettings(patch = {}) {
  const current = getAiRuntimeSettings();
  const next = {
    enabled: patch.enabled == null ? current.enabled : Boolean(patch.enabled),
    requireCode: patch.requireCode == null ? current.requireCode : Boolean(patch.requireCode),
    dailyLimit: patch.dailyLimit == null ? current.dailyLimit : normalizeAiDailyLimit(patch.dailyLimit),
    mode: patch.mode == null ? current.mode : normalizeAiMode(patch.mode),
  };
  const updatedAt = nowMs();

  upsertAppSettingStmt.run('ai.enabled', next.enabled ? '1' : '0', updatedAt);
  upsertAppSettingStmt.run('ai.require_code', next.requireCode ? '1' : '0', updatedAt);
  upsertAppSettingStmt.run('ai.daily_limit', String(next.dailyLimit), updatedAt);
  upsertAppSettingStmt.run('ai.mode', next.mode, updatedAt);

  return next;
}

export function getHomepageNotice() {
  const textRow = getAppSettingStmt.get('site.notice_text');
  const updatedAtRow = getAppSettingStmt.get('site.notice_updated_at');
  const message = sanitizeNullableValue(textRow?.value);
  const updatedAt = updatedAtRow?.value ? Number(updatedAtRow.value) : null;

  return {
    message,
    updatedAt: Number.isInteger(updatedAt) && updatedAt > 0 ? updatedAt : null,
  };
}

export function updateHomepageNotice(message) {
  const normalizedMessage = sanitizeNullableValue(message);
  const updatedAt = nowMs();

  upsertAppSettingStmt.run('site.notice_text', normalizedMessage || '', updatedAt);
  upsertAppSettingStmt.run('site.notice_updated_at', String(updatedAt), updatedAt);

  return {
    message: normalizedMessage,
    updatedAt,
  };
}

export function clearHomepageNotice() {
  return updateHomepageNotice('');
}

export function getAiUsageStats(now = nowMs()) {
  const range = getLocalDayRange(now);
  const row = countAiRequestsBetweenStmt.get(range.start, range.end) || {};
  const usedToday = Number(row.total || 0);
  const settings = getAiRuntimeSettings();
  const remainingToday = settings.dailyLimit > 0
    ? Math.max(0, settings.dailyLimit - usedToday)
    : null;

  return {
    dayStartAt: range.start,
    nextResetAt: range.end,
    usedToday,
    dailyLimit: settings.dailyLimit,
    remainingToday,
    enabled: settings.enabled,
    requireCode: settings.requireCode,
  };
}

export function recordAiRequestUsage({
  requestKind = 'answers',
  model = null,
  status = 'sent',
  title = null,
  sourceFilename = null,
  browserId = null,
  fingerprint = null,
  requestIp = null,
  requestUserAgent = null,
  now = nowMs(),
} = {}) {
  insertAiRequestLogStmt.run(
    now,
    sanitizeNullableValue(requestKind) || 'answers',
    sanitizeNullableValue(model),
    sanitizeNullableValue(status) || 'sent',
    sanitizeNullableValue(title),
    sanitizeNullableValue(sourceFilename),
    sanitizeNullableValue(browserId),
    sanitizeNullableValue(fingerprint),
    sanitizeNullableValue(requestIp),
    sanitizeNullableValue(requestUserAgent),
  );

  return getAiUsageStats(now);
}

export function reserveAiRequestSlot({
  requestKind = 'answers',
  model = null,
  title = null,
  sourceFilename = null,
  browserId = null,
  fingerprint = null,
  requestIp = null,
  requestUserAgent = null,
  now = nowMs(),
} = {}) {
  const tx = createTransaction(() => {
    const settings = getAiRuntimeSettings();
    if (!settings.enabled) {
      const error = new Error('AI is disabled by admin.');
      error.statusCode = 403;
      throw error;
    }

    const range = getLocalDayRange(now);
    const row = countAiRequestsBetweenStmt.get(range.start, range.end) || {};
    const usedToday = Number(row.total || 0);
    if (settings.dailyLimit > 0 && usedToday >= settings.dailyLimit) {
      const error = new Error(`AI daily limit reached: ${usedToday}/${settings.dailyLimit}.`);
      error.statusCode = 429;
      throw error;
    }

    insertAiRequestLogStmt.run(
      now,
      sanitizeNullableValue(requestKind) || 'answers',
      sanitizeNullableValue(model),
      'sent',
      sanitizeNullableValue(title),
      sanitizeNullableValue(sourceFilename),
      sanitizeNullableValue(browserId),
      sanitizeNullableValue(fingerprint),
      sanitizeNullableValue(requestIp),
      sanitizeNullableValue(requestUserAgent),
    );

    return {
      usedToday: usedToday + 1,
      dailyLimit: settings.dailyLimit,
      remainingToday: settings.dailyLimit > 0 ? Math.max(0, settings.dailyLimit - usedToday - 1) : null,
      nextResetAt: range.end,
    };
  });

  return tx();
}

export function listAiRequestLogs(limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  return listAiRequestLogsStmt.all(safeLimit).map((row) => ({
    id: Number(row.id),
    createdAt: Number(row.createdAt || 0),
    requestKind: row.requestKind || '',
    model: row.model || null,
    status: row.status || '',
    title: row.title || null,
    sourceFilename: row.sourceFilename || null,
    browserId: row.browserId || null,
    fingerprint: row.fingerprint || null,
    requestIp: row.requestIp || null,
    requestUserAgent: row.requestUserAgent || null,
  }));
}

export function getAiPrepareCooldownState(browserId, cooldownMs = 60 * 1000, now = nowMs()) {
  const normalizedBrowserId = sanitizeNullableValue(browserId);
  const safeCooldownMs = Math.max(0, Number(cooldownMs) || 0);
  if (!normalizedBrowserId || safeCooldownMs < 1) {
    return {
      active: false,
      cooldownMs: safeCooldownMs,
      remainingMs: 0,
      retryAt: null,
      lastAcceptedAt: null,
      title: null,
      sourceFilename: null,
    };
  }

  const row = getLastAiPrepareAcceptedByBrowserStmt.get(normalizedBrowserId);
  const lastAcceptedAt = Number(row?.createdAt || 0);
  if (!lastAcceptedAt) {
    return {
      active: false,
      cooldownMs: safeCooldownMs,
      remainingMs: 0,
      retryAt: null,
      lastAcceptedAt: null,
      title: row?.title || null,
      sourceFilename: row?.sourceFilename || null,
    };
  }

  const retryAt = lastAcceptedAt + safeCooldownMs;
  const remainingMs = Math.max(0, retryAt - Number(now || nowMs()));

  return {
    active: remainingMs > 0,
    cooldownMs: safeCooldownMs,
    remainingMs,
    retryAt,
    lastAcceptedAt,
    title: row?.title || null,
    sourceFilename: row?.sourceFilename || null,
  };
}

export function banAiDevice(browserId, reason = null) {
  const normalized = sanitizeNullableValue(browserId);
  if (!normalized) {
    return null;
  }

  const createdAt = nowMs();
  upsertAiDeviceBanStmt.run(normalized, sanitizeNullableValue(reason), createdAt);
  return getAiDeviceBan(normalized);
}

export function unbanAiDevice(browserId) {
  const normalized = sanitizeNullableValue(browserId);
  if (!normalized) {
    return false;
  }

  const result = deleteAiDeviceBanStmt.run(normalized);
  return Number(result.changes || 0) > 0;
}

export function getAiDeviceBan(browserId) {
  const normalized = sanitizeNullableValue(browserId);
  if (!normalized) {
    return null;
  }

  const row = getAiDeviceBanStmt.get(normalized);
  return row ? {
    browserId: row.browserId,
    reason: row.reason || null,
    createdAt: Number(row.createdAt || 0),
  } : null;
}

export function isAiDeviceBanned(browserId) {
  return Boolean(getAiDeviceBan(browserId));
}

export function listAiDeviceBans(limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  return listAiDeviceBansStmt.all(safeLimit).map((row) => ({
    browserId: row.browserId,
    reason: row.reason || null,
    createdAt: Number(row.createdAt || 0),
  }));
}

export function banSiteDevice(deviceId, durationMs, reason = null) {
  const normalized = sanitizeNullableValue(deviceId);
  const numericDurationMs = Number(durationMs);
  if (!normalized || !Number.isInteger(numericDurationMs) || numericDurationMs < 60 * 60 * 1000) {
    return null;
  }

  const createdAt = nowMs();
  const expiresAt = createdAt + numericDurationMs;
  upsertSiteDeviceBanStmt.run(normalized, sanitizeNullableValue(reason), createdAt, expiresAt);
  return getSiteDeviceBan(normalized, createdAt);
}

export function unbanSiteDevice(deviceId) {
  const normalized = sanitizeNullableValue(deviceId);
  if (!normalized) {
    return false;
  }

  const result = deleteSiteDeviceBanStmt.run(normalized);
  return Number(result.changes || 0) > 0;
}

export function getSiteDeviceBan(deviceId, now = nowMs()) {
  const normalized = sanitizeNullableValue(deviceId);
  if (!normalized) {
    return null;
  }

  const safeNow = Number(now) || nowMs();
  deleteExpiredSiteDeviceBansStmt.run(safeNow);
  const row = getSiteDeviceBanStmt.get(normalized);
  if (!row) {
    return null;
  }

  const expiresAt = Number(row.expiresAt || 0);
  if (!expiresAt || expiresAt <= safeNow) {
    deleteSiteDeviceBanStmt.run(normalized);
    return null;
  }

  return {
    deviceId: row.deviceId,
    reason: row.reason || null,
    createdAt: Number(row.createdAt || 0),
    expiresAt,
    remainingMs: Math.max(0, expiresAt - safeNow),
  };
}

export function listSiteDeviceBans(limit = 20, now = nowMs()) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const safeNow = Number(now) || nowMs();
  deleteExpiredSiteDeviceBansStmt.run(safeNow);
  return listSiteDeviceBansStmt.all(safeNow, safeLimit).map((row) => ({
    deviceId: row.deviceId,
    reason: row.reason || null,
    createdAt: Number(row.createdAt || 0),
    expiresAt: Number(row.expiresAt || 0),
    remainingMs: Math.max(0, Number(row.expiresAt || 0) - safeNow),
  }));
}

export function warnSiteDevice(deviceId, reason = null) {
  const normalized = sanitizeNullableValue(deviceId);
  if (!normalized) {
    return null;
  }

  const createdAt = nowMs();
  upsertSiteDeviceWarningStmt.run(normalized, sanitizeNullableValue(reason), createdAt);
  return getSiteDeviceWarning(normalized);
}

export function unwarnSiteDevice(deviceId) {
  const normalized = sanitizeNullableValue(deviceId);
  if (!normalized) {
    return false;
  }

  const result = deleteSiteDeviceWarningStmt.run(normalized);
  return Number(result.changes || 0) > 0;
}

export function getSiteDeviceWarning(deviceId) {
  const normalized = sanitizeNullableValue(deviceId);
  if (!normalized) {
    return null;
  }

  const row = getSiteDeviceWarningStmt.get(normalized);
  return row ? {
    deviceId: row.deviceId,
    reason: row.reason || null,
    createdAt: Number(row.createdAt || 0),
  } : null;
}

export function listSiteDeviceWarnings(limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  return listSiteDeviceWarningsStmt.all(safeLimit).map((row) => ({
    deviceId: row.deviceId,
    reason: row.reason || null,
    createdAt: Number(row.createdAt || 0),
  }));
}

export function createAccessCodes(count = 1, label = null, metadata = {}) {
  const total = Math.max(1, Math.min(100, Number(count) || 1));
  const createdAt = nowMs();
  const codes = [];
  const siteType = normalizeSiteType(metadata.siteType);
  const clientTgUserId = normalizeTelegramUserId(metadata.clientTgUserId);
  const clientTgUsername = normalizeClientUsername(metadata.clientTgUsername);
  const expectedQuestionCount = normalizeExpectedQuestionCount(metadata.expectedQuestionCount);
  const remainingQuestionCount = normalizeRemainingQuestionCount(metadata.remainingQuestionCount, expectedQuestionCount);
  const price = normalizePrice(metadata.price);

  const tx = createTransaction(() => {
    while (codes.length < total) {
      const code = generateAccessCode();
      const codeHash = hashCode(code);

      try {
        insertCodeStmt.run(
          codeHash,
          sanitizeNullableValue(label),
          siteType,
          clientTgUserId,
          clientTgUsername,
          expectedQuestionCount,
          remainingQuestionCount,
          0,
          price,
          1,
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
  const clientTgUserId = normalizeTelegramUserId(metadata.clientTgUserId);
  const clientTgUsername = normalizeClientUsername(metadata.clientTgUsername);
  const expectedQuestionCount = normalizeExpectedQuestionCount(metadata.expectedQuestionCount);
  const remainingQuestionCount = normalizeRemainingQuestionCount(metadata.remainingQuestionCount, expectedQuestionCount);
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
        clientTgUserId,
        clientTgUsername,
        expectedQuestionCount,
        remainingQuestionCount,
        0,
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
      clientTgUserId: existing.clientTgUserId != null ? Number(existing.clientTgUserId) : null,
      clientTgUsername: existing.clientTgUsername || null,
      expectedQuestionCount: existing.expectedQuestionCount ? Number(existing.expectedQuestionCount) : null,
      remainingQuestionCount: existing.remainingQuestionCount != null ? Number(existing.remainingQuestionCount) : null,
      consumedQuestionCount: Number(existing.consumedQuestionCount || 0),
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
    clientTgUserId: updated.clientTgUserId != null ? Number(updated.clientTgUserId) : null,
    clientTgUsername: updated.clientTgUsername || null,
    expectedQuestionCount: updated.expectedQuestionCount ? Number(updated.expectedQuestionCount) : null,
    remainingQuestionCount: updated.remainingQuestionCount != null ? Number(updated.remainingQuestionCount) : null,
    consumedQuestionCount: Number(updated.consumedQuestionCount || 0),
    price: Number(updated.price || 0),
    isReusable: Number(updated.isReusable || 0) === 1,
    revokedAt: updated.revokedAt ? Number(updated.revokedAt) : null,
    alreadyRevoked: false,
  };
}

export function inspectAccessCode(plainCode) {
  const normalized = normalizeCode(plainCode);
  if (!normalized) {
    return null;
  }

  const existing = findAccessCodeByHashStmt.get(hashCode(normalized));
  if (!existing || existing.revokedAt) {
    return null;
  }

  return {
    id: Number(existing.id),
    label: existing.label || null,
    siteType: existing.siteType || null,
    clientTgUserId: existing.clientTgUserId != null ? Number(existing.clientTgUserId) : null,
    clientTgUsername: existing.clientTgUsername || null,
    expectedQuestionCount: existing.expectedQuestionCount ? Number(existing.expectedQuestionCount) : null,
    remainingQuestionCount: existing.remainingQuestionCount != null ? Number(existing.remainingQuestionCount) : null,
    consumedQuestionCount: Number(existing.consumedQuestionCount || 0),
    price: Number(existing.price || 0),
    isReusable: Number(existing.isReusable || 0) === 1,
    revokedAt: existing.revokedAt ? Number(existing.revokedAt) : null,
    usedAt: existing.usedAt ? Number(existing.usedAt) : null,
    usedByQuizId: existing.usedByQuizId ? Number(existing.usedByQuizId) : null,
  };
}

export function topUpAccessCode(plainCode, questionCount) {
  const normalized = normalizeCode(plainCode);
  const normalizedQuestionCount = normalizeExpectedQuestionCount(questionCount);
  if (!normalized || !normalizedQuestionCount) {
    return null;
  }

  const update = topUpAccessCodeStmt.run(
    normalizedQuestionCount,
    normalizedQuestionCount,
    hashCode(normalized),
  );
  if (update.changes !== 1) {
    return null;
  }

  return inspectAccessCode(normalized);
}

export function createClientAccessCode({ clientTgUserId, clientTgUsername, label = null } = {}) {
  const createdAt = nowMs();
  const normalizedUserId = normalizeTelegramUserId(clientTgUserId);
  const normalizedUsername = normalizeClientUsername(clientTgUsername);
  let code = '';

  while (!code) {
    const candidate = generateAccessCode();
    const candidateHash = hashCode(candidate);
    if (findAccessCodeByHashStmt.get(candidateHash)) {
      continue;
    }

    try {
      const storedLabel = sanitizeNullableValue(label) || candidate;
      insertClientEmptyCodeStmt.run(
        candidateHash,
        storedLabel,
        normalizedUserId,
        normalizedUsername,
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

export function listAccessCodesByClient({ clientTgUserId = null, clientTgUsername = null } = {}) {
  const normalizedUserId = normalizeTelegramUserId(clientTgUserId);
  const normalizedUsername = normalizeClientUsername(clientTgUsername);
  if (!normalizedUserId && !normalizedUsername) {
    return [];
  }

  return listAccessCodesByOwnerStmt
    .all(normalizedUserId, normalizedUsername, normalizedUsername)
    .map(mapAccessCodeRow);
}

export function listActiveAiAccessCodes(limit = 20) {
  const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  return listActiveAiAccessCodesStmt
    .all(hashCode(internalAiFreeCode), normalizedLimit)
    .map(mapAccessCodeRow);
}

export function getPaymentCooldownState({ tgUserId, cooldownMs = 60 * 60 * 1000, now = nowMs() }) {
  const normalizedUserId = normalizeTelegramUserId(tgUserId);
  if (!normalizedUserId) {
    return {
      allowed: false,
      nextAllowedAt: null,
      remainingMs: Math.max(0, Number(cooldownMs) || 0),
    };
  }

  expirePaymentSessionsStmt.run(now);
  const latest = getLatestPaymentSessionByUserStmt.get(normalizedUserId);
  if (!latest) {
    return {
      allowed: true,
      nextAllowedAt: now,
      remainingMs: 0,
    };
  }

  const nextAllowedAt = Number(latest.createdAt || 0) + Math.max(0, Number(cooldownMs) || 0);
  return {
    allowed: nextAllowedAt <= now,
    nextAllowedAt,
    remainingMs: Math.max(0, nextAllowedAt - now),
  };
}

export function getActivePaymentSession(now = nowMs()) {
  expirePaymentSessionsStmt.run(now);
  const row = getActivePaymentSessionStmt.get(now);
  return row ? mapPaymentSessionRow(row) : null;
}

export function getActivePaymentSessionByUser(tgUserId, now = nowMs()) {
  const normalizedUserId = normalizeTelegramUserId(tgUserId);
  if (!normalizedUserId) {
    return null;
  }

  expirePaymentSessionsStmt.run(now);
  const row = getActivePaymentSessionByUserStmt.get(normalizedUserId, now);
  return row ? mapPaymentSessionRow(row) : null;
}

export function createTopUpPaymentSession({
  tgUserId,
  tgUsername = null,
  targetCode,
  questionCount,
  amountMinor,
  ttlMs = 15 * 60 * 1000,
} = {}) {
  const normalizedUserId = normalizeTelegramUserId(tgUserId);
  const normalizedUsername = normalizeClientUsername(tgUsername);
  const normalizedCode = normalizeCode(targetCode);
  const normalizedQuestionCount = normalizeExpectedQuestionCount(questionCount);
  const normalizedAmountMinor = normalizeAmountMinor(amountMinor);
  const createdAt = nowMs();
  const expiresAt = createdAt + Math.max(60 * 1000, Number(ttlMs) || (15 * 60 * 1000));

  if (!normalizedUserId || !normalizedCode || !normalizedQuestionCount || !normalizedAmountMinor) {
    return { ok: false, error: 'invalid_input' };
  }

  const tx = createTransaction(() => {
    expirePaymentSessionsStmt.run(createdAt);
    const active = getActivePaymentSessionStmt.get(createdAt);
    if (active) {
      return { ok: false, error: 'busy', activeSession: mapPaymentSessionRow(active) };
    }

    insertPaymentSessionStmt.run(
      normalizedUserId,
      normalizedUsername,
      normalizedCode,
      normalizedQuestionCount,
      normalizedAmountMinor,
      createdAt,
      expiresAt,
    );

    const session = getActivePaymentSessionByUserStmt.get(normalizedUserId, createdAt);
    return session
      ? { ok: true, session: mapPaymentSessionRow(session) }
      : { ok: false, error: 'create_failed' };
  });

  return tx();
}

export function cancelPaymentSession(sessionId, reason = 'cancelled') {
  const numericSessionId = Number(sessionId);
  if (!Number.isInteger(numericSessionId) || numericSessionId < 1) {
    return null;
  }

  cancelPaymentSessionByIdStmt.run(sanitizeNullableValue(reason) || 'cancelled', numericSessionId);
  const row = getPaymentSessionByIdStmt.get(numericSessionId);
  return row ? mapPaymentSessionRow(row) : null;
}

export function completeTopUpPaymentSession(sessionId, statementId) {
  const numericSessionId = Number(sessionId);
  const normalizedStatementId = sanitizeNullableValue(statementId);
  if (!Number.isInteger(numericSessionId) || numericSessionId < 1 || !normalizedStatementId) {
    return null;
  }

  const confirmedAt = nowMs();
  const tx = createTransaction(() => {
    expirePaymentSessionsStmt.run(confirmedAt);
    const existing = getPaymentSessionByIdStmt.get(numericSessionId);
    if (!existing || existing.status !== 'pending' || Number(existing.expiresAt || 0) <= confirmedAt) {
      return null;
    }

    const topUpResult = topUpAccessCodeStmt.run(
      Number(existing.questionCount || 0),
      Number(existing.questionCount || 0),
      hashCode(normalizeCode(existing.targetCode)),
    );
    if (topUpResult.changes !== 1) {
      return null;
    }

    const update = completePaymentSessionStmt.run(confirmedAt, normalizedStatementId, numericSessionId);
    if (update.changes !== 1) {
      throw new Error('payment_session_already_matched');
    }

    const session = getPaymentSessionByIdStmt.get(numericSessionId);
    const code = inspectAccessCode(existing.targetCode);
    return session && code
      ? { session: mapPaymentSessionRow(session), code }
      : null;
  });

  return tx();
}

export function consumeAccessCodeQuestions(plainCode, questionCount) {
  const normalized = normalizeCode(plainCode);
  const normalizedQuestionCount = normalizeExpectedQuestionCount(questionCount);
  if (!normalized || !normalizedQuestionCount) {
    return null;
  }

  const tx = createTransaction(() => {
    const existing = findAccessCodeByHashStmt.get(hashCode(normalized));
    if (!existing || existing.revokedAt) {
      return null;
    }

    if (existing.remainingQuestionCount == null) {
    return {
      codeId: Number(existing.id),
      consumedQuestions: 0,
      remainingQuestionCount: null,
      expectedQuestionCount: existing.expectedQuestionCount ? Number(existing.expectedQuestionCount) : null,
      clientTgUserId: existing.clientTgUserId != null ? Number(existing.clientTgUserId) : null,
      clientTgUsername: existing.clientTgUsername || null,
        siteType: existing.siteType || null,
        label: existing.label || null,
        price: Number(existing.price || 0),
      };
    }

    const update = consumeAccessCodeQuestionsStmt.run(
      normalizedQuestionCount,
      normalizedQuestionCount,
      hashCode(normalized),
      normalizedQuestionCount,
    );
    if (update.changes !== 1) {
      return null;
    }

    const updated = findAccessCodeByHashStmt.get(hashCode(normalized));
    return {
      codeId: Number(updated.id),
      consumedQuestions: normalizedQuestionCount,
      remainingQuestionCount: updated.remainingQuestionCount != null ? Number(updated.remainingQuestionCount) : null,
      expectedQuestionCount: updated.expectedQuestionCount ? Number(updated.expectedQuestionCount) : null,
      clientTgUserId: updated.clientTgUserId != null ? Number(updated.clientTgUserId) : null,
      clientTgUsername: updated.clientTgUsername || null,
      siteType: updated.siteType || null,
      label: updated.label || null,
      price: Number(updated.price || 0),
    };
  });

  return tx();
}

export function refundAccessCodeQuestions(codeId, questionCount) {
  const numericCodeId = Number(codeId);
  const normalizedQuestionCount = normalizeExpectedQuestionCount(questionCount);
  if (!Number.isInteger(numericCodeId) || numericCodeId < 1 || !normalizedQuestionCount) {
    return null;
  }

  const update = refundAccessCodeQuestionsStmt.run(
    normalizedQuestionCount,
    normalizedQuestionCount,
    normalizedQuestionCount,
    numericCodeId,
  );
  if (update.changes !== 1) {
    return null;
  }

  const row = getCodeById(numericCodeId);
  return row ? mapAccessCodeRow(row) : null;
}

export function reserveAccessCode(plainCode) {
  const normalized = normalizeCode(plainCode);
  if (!normalized) {
    return null;
  }

  const reservationToken = randomToken();
  const reservedAt = nowMs();
  const staleBefore = reservedAt - reservationWindowMs;

  const tx = createTransaction(() => {
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
      clientTgUserId: row.clientTgUserId != null ? Number(row.clientTgUserId) : null,
      clientTgUsername: row.clientTgUsername || null,
      expectedQuestionCount: row.expectedQuestionCount ? Number(row.expectedQuestionCount) : null,
      price: Number(row.price || 0),
      isReusable: Number(row.isReusable || 0) === 1,
    };
  });

  return tx();
}

export function reserveInternalAiAccessCode() {
  return reserveAccessCode(internalAiFreeCode);
}

export function releaseReservation(reservationToken) {
  if (!reservationToken) {
    return;
  }

  releaseReservationStmt.run(reservationToken);
}

export function createQuizDraft({
  title,
  courseNumber,
  sourceFilename,
  answerIndex,
  requestedCount,
  questions,
  reviewBlocks = [],
  rawModelJson,
  sourceUploadPath = null,
  sourceUploadName = null,
  answerUploadPath = null,
  answerUploadName = null,
}) {
  const createdAt = nowMs();
  const draftToken = randomToken();
  const staleBefore = createdAt - draftTtlMs;

  clearExpiredDraftsStmt.run(staleBefore);
  insertDraftStmt.run(
    draftToken,
    title,
    courseNumber,
    sourceFilename,
    answerIndex,
    requestedCount,
    questions.length,
    JSON.stringify(questions),
    JSON.stringify(reviewBlocks),
    JSON.stringify(rawModelJson),
    sanitizeNullableValue(sourceUploadPath),
    sanitizeNullableValue(sourceUploadName),
    sanitizeNullableValue(answerUploadPath),
    sanitizeNullableValue(answerUploadName),
    createdAt,
  );

  return {
    draftToken,
    courseNumber,
    parsedCount: questions.length,
    requestedCount,
    createdAt,
  };
}

export function inspectQuizDraft(draftToken) {
  const normalizedToken = String(draftToken || '').trim();
  if (!normalizedToken) {
    return null;
  }

  const row = getDraftByTokenStmt.get(normalizedToken);
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    draftToken: row.draft_token,
    title: row.title,
    courseNumber: Number(row.course_number || 0),
    requestedCount: Number(row.requested_count || 0),
    parsedCount: Number(row.parsed_count || 0),
    rawModel: parseJsonField(row.raw_model_json, {}),
    createdAt: Number(row.created_at || 0),
  };
}

export function attachDraftUploads({
  draftToken,
  sourceUploadPath = null,
  sourceUploadName = null,
  answerUploadPath = null,
  answerUploadName = null,
}) {
  if (!draftToken) {
    return;
  }

  updateDraftUploadsByTokenStmt.run(
    sanitizeNullableValue(sourceUploadPath),
    sanitizeNullableValue(sourceUploadName),
    sanitizeNullableValue(answerUploadPath),
    sanitizeNullableValue(answerUploadName),
    draftToken,
  );
}

export function updateQuizDraftContent({
  draftToken,
  questions,
  reviewBlocks = [],
  rawModelJson = {},
}) {
  const normalizedToken = String(draftToken || '').trim();
  if (!normalizedToken) {
    return null;
  }

  const parsedCount = Array.isArray(questions) ? questions.length : 0;
  updateDraftContentByTokenStmt.run(
    parsedCount,
    JSON.stringify(Array.isArray(questions) ? questions : []),
    JSON.stringify(Array.isArray(reviewBlocks) ? reviewBlocks : []),
    JSON.stringify(rawModelJson && typeof rawModelJson === 'object' ? rawModelJson : {}),
    normalizedToken,
  );

  return inspectQuizDraft(normalizedToken);
}

export function finalizeQuizFromDraftReservation({
  reservationToken,
  draftToken,
  creatorSnapshot = null,
  clientTgUsername = null,
}) {
  const createdAt = nowMs();
  const expiresAt = quizPublicTtlMs > 0 ? createdAt + quizPublicTtlMs : null;
  const staleBefore = createdAt - draftTtlMs;
  const normalizedCreatorSnapshot = normalizeCreatorSnapshot(creatorSnapshot, createdAt);
  const normalizedBrowserId = sanitizeNullableValue(normalizedCreatorSnapshot?.browserId);
  const normalizedClientTgUsername = normalizeClientUsername(clientTgUsername);

  const tx = createTransaction(() => {
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

    const rememberedDeviceClient = normalizedBrowserId
      ? getDeviceClientLinkStmt.get(normalizedBrowserId)
      : null;
    const resolvedClientTgUsername = normalizedClientTgUsername
      || normalizeClientUsername(rememberedDeviceClient?.clientTgUsername)
      || codeRow.clientTgUsername
      || null;

    let slug = generateSlug();
    while (getQuizBySlugStmt.get(slug)) {
      slug = generateSlug();
    }

    const quizInsert = insertQuizStmt.run(
      slug,
      draftRow.title,
      Number(draftRow.course_number || 0),
      resolvedClientTgUsername,
      draftRow.source_filename,
      draftRow.answer_index,
      draftRow.requested_count,
      parsedCount,
      draftRow.questions_json,
      draftRow.review_blocks_json,
      draftRow.raw_model_json,
      JSON.stringify(normalizedCreatorSnapshot),
      sanitizeNullableValue(draftRow.source_upload_path),
      sanitizeNullableValue(draftRow.source_upload_name),
      sanitizeNullableValue(draftRow.answer_upload_path),
      sanitizeNullableValue(draftRow.answer_upload_name),
      createdAt,
      expiresAt,
      codeRow.id,
    );

    markCodeUsedStmt.run(createdAt, quizInsert.lastInsertRowid, codeRow.id);
    if (normalizedBrowserId && resolvedClientTgUsername) {
      upsertDeviceClientLinkStmt.run(normalizedBrowserId, resolvedClientTgUsername, createdAt);
    }
    deleteDraftByTokenStmt.run(draftToken);

    return {
      id: Number(quizInsert.lastInsertRowid),
      slug,
      courseNumber: Number(draftRow.course_number || 0),
      siteType: codeRow.siteType || null,
      clientTgUsername: resolvedClientTgUsername,
      expectedQuestionCount,
      price: Number(codeRow.price || 0),
      codeLabel: codeRow.label || null,
      expiresAt,
      creatorSnapshot: normalizedCreatorSnapshot,
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

export function getQuizQuestionStatsByRange(startQuizId, endQuizId) {
  const numericStartQuizId = Number(startQuizId);
  const numericEndQuizId = Number(endQuizId);
  if (!Number.isInteger(numericStartQuizId) || !Number.isInteger(numericEndQuizId)) {
    return null;
  }

  const normalizedStartQuizId = Math.min(numericStartQuizId, numericEndQuizId);
  const normalizedEndQuizId = Math.max(numericStartQuizId, numericEndQuizId);
  if (normalizedStartQuizId < 1 || normalizedEndQuizId < 1) {
    return null;
  }

  const row = getQuizQuestionStatsByRangeStmt.get(normalizedStartQuizId, normalizedEndQuizId) || {};
  return {
    startQuizId: normalizedStartQuizId,
    endQuizId: normalizedEndQuizId,
    quizCount: Number(row.quizCount || 0),
    totalQuestions: Number(row.totalQuestions || 0),
    firstQuizId: row.firstQuizId ? Number(row.firstQuizId) : null,
    lastQuizId: row.lastQuizId ? Number(row.lastQuizId) : null,
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
    courseNumber: Number(row.courseNumber || 0),
    rawModelJson: parseJsonField(row.rawModelJson, {}),
    creatorSnapshot: parseJsonField(row.creatorSnapshotJson, {}),
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

export function listActiveQuizzesByClientUsername(clientTgUsername, now = nowMs()) {
  const normalizedUsername = normalizeClientUsername(clientTgUsername);
  if (!normalizedUsername) {
    return [];
  }

  const activeAt = Number(now || nowMs());
  return listQuizLinksStmt.all()
    .map(mapQuizLinkRow)
    .filter((quiz) => quiz.clientTgUsername === normalizedUsername && isQuizLinkActiveAt(quiz, activeAt));
}

export function listActiveQuizzesByBrowserId(browserId, now = nowMs()) {
  const normalizedBrowserId = sanitizeNullableValue(browserId);
  if (!normalizedBrowserId) {
    return [];
  }

  const activeAt = Number(now || nowMs());
  return listQuizLinksStmt.all()
    .map(mapQuizLinkRow)
    .filter((quiz) => quiz.creatorSnapshot?.browserId === normalizedBrowserId && isQuizLinkActiveAt(quiz, activeAt));
}

export function getRememberedClientUsernameByBrowserId(browserId) {
  const normalizedBrowserId = sanitizeNullableValue(browserId);
  if (!normalizedBrowserId) {
    return null;
  }

  return normalizeClientUsername(getDeviceClientLinkStmt.get(normalizedBrowserId)?.clientTgUsername) || null;
}

export function getAccountingSummary() {
  const row = accountingSummaryStmt.get() || {};
  return {
    usedCodeCount: Number(row.usedCodeCount || 0),
    consumedQuestionCount: Number(row.consumedQuestionCount || 0),
    totalAmount: Number(row.totalAmount || 0),
  };
}

export function createQuizReport({ quizId, note = null, reporterSnapshot = null }) {
  const quiz = getQuizById(quizId);
  if (!quiz) {
    return null;
  }

  const normalizedNote = sanitizeNullableValue(note);
  if (!normalizedNote) {
    return null;
  }

  const createdAt = nowMs();
  const insert = insertQuizReportStmt.run(
    quiz.id,
    normalizedNote,
    JSON.stringify(normalizeReporterSnapshot(reporterSnapshot, createdAt)),
    createdAt,
  );

  return getQuizReportById(insert.lastInsertRowid);
}

export function listQuizReports(limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  return listQuizReportsStmt.all(safeLimit).map(mapQuizReportRow);
}

export function getQuizReportById(reportId) {
  const numericReportId = Number(reportId);
  if (!Number.isInteger(numericReportId) || numericReportId < 1) {
    return null;
  }

  const row = getQuizReportByIdStmt.get(numericReportId);
  return row ? mapQuizReportRow(row) : null;
}

export function createUploadReport({
  title = null,
  note = null,
  sourceUploadPath = null,
  sourceUploadName = null,
  answerUploadPath = null,
  answerUploadName = null,
  reporterSnapshot = null,
}) {
  const normalizedNote = sanitizeNullableValue(note);
  if (!normalizedNote) {
    return null;
  }

  const createdAt = nowMs();
  const insert = insertUploadReportStmt.run(
    sanitizeNullableValue(title),
    normalizedNote,
    sanitizeNullableValue(sourceUploadPath),
    sanitizeNullableValue(sourceUploadName),
    sanitizeNullableValue(answerUploadPath),
    sanitizeNullableValue(answerUploadName),
    JSON.stringify(normalizeReporterSnapshot(reporterSnapshot, createdAt)),
    createdAt,
  );

  return getUploadReportById(insert.lastInsertRowid);
}

export function listUploadReports(limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  return listUploadReportsStmt.all(safeLimit).map(mapUploadReportRow);
}

export function getUploadReportById(reportId) {
  const numericReportId = Number(reportId);
  if (!Number.isInteger(numericReportId) || numericReportId < 1) {
    return null;
  }

  const row = getUploadReportByIdStmt.get(numericReportId);
  return row ? mapUploadReportRow(row) : null;
}

export function deleteQuizReportById(reportId) {
  const numericReportId = Number(reportId);
  if (!Number.isInteger(numericReportId) || numericReportId < 1) {
    return null;
  }

  const existing = getQuizReportById(numericReportId);
  if (!existing) {
    return null;
  }

  deleteQuizReportByIdStmt.run(numericReportId);
  return existing;
}

export function deleteUploadReportById(reportId) {
  const numericReportId = Number(reportId);
  if (!Number.isInteger(numericReportId) || numericReportId < 1) {
    return null;
  }

  const existing = getUploadReportById(numericReportId);
  if (!existing) {
    return null;
  }

  deleteUploadReportByIdStmt.run(numericReportId);
  return existing;
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

  const tx = createTransaction(() => {
    deleteQuizReportsByQuizIdStmt.run(numericQuizId);
    deleteQuizCorrectionsByQuizIdStmt.run(numericQuizId);
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

export function applyQuizQuestionCorrection({ quizId, questionIndex, question, correction }) {
  const quiz = getQuizById(quizId);
  if (!quiz) {
    return null;
  }

  const questions = Array.isArray(quiz.questions) ? [...quiz.questions] : [];
  if (questionIndex < 1 || questionIndex > questions.length) {
    return { error: 'question_not_found' };
  }

  const createdAt = nowMs();
  const tx = createTransaction(() => {
    questions[questionIndex - 1] = question;
    persistQuizContent(quiz, questions, quiz.reviewBlocks || []);

    insertQuizCorrectionStmt.run(
      quiz.id,
      questionIndex,
      correction?.visibleQuestionNumber != null ? Number(correction.visibleQuestionNumber) : null,
      correction?.configuredOptionCount != null ? Number(correction.configuredOptionCount) : null,
      Boolean(correction?.shuffleQuestions) ? 1 : 0,
      JSON.stringify(Array.isArray(correction?.shuffledOptionOrder) ? correction.shuffledOptionOrder : []),
      sanitizeNullableValue(correction?.originalQuestionText) || sanitizeNullableValue(quiz.questions?.[questionIndex - 1]?.q) || '',
      sanitizeNullableValue(correction?.editedQuestionText) || sanitizeNullableValue(question?.q) || '',
      JSON.stringify(Array.isArray(correction?.originalOptionsSourceOrder) ? correction.originalOptionsSourceOrder : []),
      JSON.stringify(Array.isArray(correction?.editedOptionsVisibleOrder) ? correction.editedOptionsVisibleOrder : (question?.options || [])),
      createdAt,
    );

    trimQuizCorrectionsStmt.run();
    return getQuizById(quiz.id);
  });

  return tx();
}

export function listQuizCorrections(limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  return listQuizCorrectionsStmt.all(safeLimit).map(mapQuizCorrectionRow);
}

export function getQuizCorrectionById(correctionId) {
  const numericCorrectionId = Number(correctionId);
  if (!Number.isInteger(numericCorrectionId) || numericCorrectionId < 1) {
    return null;
  }

  const row = getQuizCorrectionByIdStmt.get(numericCorrectionId);
  return row ? mapQuizCorrectionRow(row) : null;
}

export function listQuizCorrectionsByQuizId(quizId) {
  const numericQuizId = Number(quizId);
  if (!Number.isInteger(numericQuizId) || numericQuizId < 1) {
    return [];
  }

  return listQuizCorrectionsByQuizIdStmt.all(numericQuizId).map(mapQuizCorrectionRow);
}

function mapQuizRow(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    courseNumber: Number(row.course_number || row.courseNumber || 0),
    sourceFilename: row.source_filename,
    answerIndex: row.answer_index,
    requestedCount: row.requested_count,
    parsedCount: row.parsed_count,
    questions: JSON.parse(row.questions_json),
    reviewBlocks: JSON.parse(row.review_blocks_json || '[]'),
    rawModelJson: JSON.parse(row.raw_model_json),
    creatorSnapshot: parseJsonField(row.creator_snapshot_json, {}),
    sourceUploadPath: row.source_upload_path || null,
    sourceUploadName: row.source_upload_name || null,
    answerUploadPath: row.answer_upload_path || null,
    answerUploadName: row.answer_upload_name || null,
    createdAt: Number(row.created_at || 0),
    expiresAt: row.expires_at ? Number(row.expires_at) : null,
    bannedAt: row.banned_at ? Number(row.banned_at) : null,
    codeId: row.code_id,
    siteType: row.siteType || null,
    clientTgUsername: row.clientTgUsername || null,
    expectedQuestionCount: row.expectedQuestionCount ? Number(row.expectedQuestionCount) : null,
    remainingQuestionCount: row.remainingQuestionCount != null ? Number(row.remainingQuestionCount) : null,
    consumedQuestionCount: Number(row.consumedQuestionCount || 0),
    price: Number(row.price || 0),
    codeLabel: row.codeLabel || null,
  };
}

function mapQuizLinkRow(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    title: row.title || '',
    courseNumber: Number(row.courseNumber || 0),
    clientTgUsername: row.clientTgUsername || null,
    creatorSnapshot: parseJsonField(row.creatorSnapshotJson, {}),
    createdAt: Number(row.createdAt || 0),
    expiresAt: row.expiresAt ? Number(row.expiresAt) : null,
    bannedAt: row.bannedAt ? Number(row.bannedAt) : null,
  };
}

function isQuizLinkActiveAt(quiz, now = nowMs()) {
  if (!quiz || quiz.bannedAt) {
    return false;
  }

  const expiresAt = Number(quiz.expiresAt || 0);
  return expiresAt <= 0 || expiresAt > Number(now || nowMs());
}

function mapQuizReportRow(row) {
  return {
    reportType: 'quiz',
    id: Number(row.id),
    quizId: Number(row.quizId),
    quizSlug: row.quizSlug || '',
    quizTitle: row.quizTitle || '',
    note: row.note || null,
    createdAt: Number(row.createdAt || 0),
    reporterSnapshot: parseJsonField(row.reporterSnapshotJson, {}),
    sourceUploadPath: row.sourceUploadPath || null,
    sourceUploadName: row.sourceUploadName || null,
    answerUploadPath: row.answerUploadPath || null,
    answerUploadName: row.answerUploadName || null,
  };
}

function mapQuizCorrectionRow(row) {
  return {
    id: Number(row.id),
    quizId: Number(row.quizId),
    quizSlug: row.quizSlug || '',
    quizTitle: row.quizTitle || '',
    questionIndex: Number(row.questionIndex || 0),
    visibleQuestionNumber: row.visibleQuestionNumber != null ? Number(row.visibleQuestionNumber) : null,
    configuredOptionCount: row.configuredOptionCount != null ? Number(row.configuredOptionCount) : null,
    shuffleQuestions: Number(row.shuffleQuestions || 0) === 1,
    shuffledOptionOrder: parseJsonField(row.shuffledOptionOrderJson, []),
    originalQuestionText: row.originalQuestionText || '',
    editedQuestionText: row.editedQuestionText || '',
    originalOptions: parseJsonField(row.originalOptionsJson, []),
    editedOptions: parseJsonField(row.editedOptionsJson, []),
    createdAt: Number(row.createdAt || 0),
  };
}

function mapUploadReportRow(row) {
  return {
    reportType: 'upload',
    id: Number(row.id),
    title: row.title || '',
    note: row.note || null,
    createdAt: Number(row.createdAt || 0),
    reporterSnapshot: parseJsonField(row.reporterSnapshotJson, {}),
    sourceUploadPath: row.sourceUploadPath || null,
    sourceUploadName: row.sourceUploadName || null,
    answerUploadPath: row.answerUploadPath || null,
    answerUploadName: row.answerUploadName || null,
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

function ensureDefaultAiSettings() {
  const settings = [
    ['ai.enabled', '1'],
    ['ai.require_code', '0'],
    ['ai.daily_limit', '0'],
    ['ai.mode', 'double'],
  ];
  const updatedAt = nowMs();

  for (const [key, value] of settings) {
    if (getAppSettingStmt.get(key)) {
      continue;
    }
    upsertAppSettingStmt.run(key, value, updatedAt);
  }
}

function syncInternalAiFreeCode() {
  upsertReusableCodeStmt.run(
    hashCode(internalAiFreeCode),
    internalAiFreeLabel,
    null,
    null,
    null,
    null,
    null,
    0,
    0,
    nowMs(),
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
    null,
    null,
    0,
    0,
    nowMs(),
  );
}

function syncLegacyAccessCodeBalances() {
  db.exec(`
    UPDATE access_codes
    SET remaining_question_count = expected_question_count
    WHERE remaining_question_count IS NULL
      AND expected_question_count IS NOT NULL
      AND code_hash NOT IN ('${hashCode(internalAiFreeCode)}'${unlimitedAccessCode ? `, '${hashCode(unlimitedAccessCode)}'` : ''})
  `);
}

function getCodeById(codeId) {
  return db.prepare(`
    SELECT
      id,
      label,
      site_type AS siteType,
      client_tg_user_id AS clientTgUserId,
      client_tg_username AS clientTgUsername,
      expected_question_count AS expectedQuestionCount,
      remaining_question_count AS remainingQuestionCount,
      consumed_question_count AS consumedQuestionCount,
      price,
      is_reusable AS isReusable,
      revoked_at AS revokedAt,
      used_at AS usedAt,
      used_by_quiz_id AS usedByQuizId
    FROM access_codes
    WHERE id = ?
  `).get(codeId);
}

function mapAccessCodeRow(row) {
  return {
    id: Number(row.id),
    label: row.label || null,
    siteType: row.siteType || null,
    clientTgUserId: row.clientTgUserId != null ? Number(row.clientTgUserId) : null,
    clientTgUsername: row.clientTgUsername || null,
    expectedQuestionCount: row.expectedQuestionCount != null ? Number(row.expectedQuestionCount) : null,
    remainingQuestionCount: row.remainingQuestionCount != null ? Number(row.remainingQuestionCount) : null,
    consumedQuestionCount: Number(row.consumedQuestionCount || 0),
    price: Number(row.price || 0),
    isReusable: Number(row.isReusable || 0) === 1,
    revokedAt: row.revokedAt ? Number(row.revokedAt) : null,
    usedAt: row.usedAt ? Number(row.usedAt) : null,
    usedByQuizId: row.usedByQuizId ? Number(row.usedByQuizId) : null,
    createdAt: row.createdAt ? Number(row.createdAt) : null,
  };
}

function ensureColumn(tableName, columnName, columnType) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const names = new Set(columns.map((column) => String(column.name)));
  if (!names.has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
  }
}

function createTransaction(handler) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = handler(...args);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Ignore rollback failures and rethrow the original error.
      }
      throw error;
    }
  };
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

function normalizeTelegramUserId(value) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : null;
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

function normalizeRemainingQuestionCount(value, fallbackValue = null) {
  if (value == null || value === '') {
    return fallbackValue == null ? null : normalizeExpectedQuestionCount(fallbackValue);
  }

  return normalizeExpectedQuestionCount(value);
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

function normalizeAmountMinor(value) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : null;
}

function normalizeAiDailyLimit(value) {
  if (value == null || value === '') {
    return 0;
  }

  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 0) {
    return 0;
  }

  return numericValue;
}

function normalizeAiMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'single' ? 'single' : 'double';
}

function readBooleanSetting(key, fallbackValue) {
  const row = getAppSettingStmt.get(key);
  if (!row) {
    return fallbackValue;
  }

  return String(row.value || '') === '1';
}

function readIntegerSetting(key, fallbackValue) {
  const row = getAppSettingStmt.get(key);
  if (!row) {
    return fallbackValue;
  }

  const numericValue = Number(row.value);
  return Number.isInteger(numericValue) && numericValue >= 0 ? numericValue : fallbackValue;
}

function readAiModeSetting(key, fallbackValue) {
  const row = getAppSettingStmt.get(key);
  if (!row) {
    return normalizeAiMode(fallbackValue);
  }

  return normalizeAiMode(row.value);
}

function getLocalDayRange(now) {
  const date = new Date(Number(now || nowMs()));
  date.setHours(0, 0, 0, 0);
  const start = date.getTime();
  const end = start + 24 * 60 * 60 * 1000;
  return { start, end };
}

function resolveQuizPublicTtlMs() {
  const rawValue = String(process.env.QUIZ_PUBLIC_TTL_DAYS || '7').trim();
  const numericDays = Number(rawValue);
  if (!Number.isFinite(numericDays) || numericDays <= 0) {
    return 0;
  }

  return Math.round(numericDays * 24 * 60 * 60 * 1000);
}

function normalizeCreatorSnapshot(snapshot, fallbackTimestamp) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return {};
  }

  return {
    capturedAt: Number(snapshot.capturedAt || fallbackTimestamp || nowMs()),
    browserId: sanitizeNullableValue(snapshot.browserId),
    fingerprint: sanitizeNullableValue(snapshot.fingerprint),
    fingerprintVersion: Number(snapshot.fingerprintVersion || 1),
    deviceClass: sanitizeNullableValue(snapshot.deviceClass),
    creationSource: sanitizeNullableValue(snapshot.creationSource),
    request: snapshot.request && typeof snapshot.request === 'object' ? snapshot.request : null,
    client: snapshot.client && typeof snapshot.client === 'object' ? snapshot.client : null,
  };
}

function normalizeReporterSnapshot(snapshot, fallbackTimestamp) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return {};
  }

  return {
    createdAt: Number(snapshot.createdAt || fallbackTimestamp || nowMs()),
    note: sanitizeNullableValue(snapshot.note),
    pageUrl: sanitizeNullableValue(snapshot.pageUrl),
    currentQuestion: Number.isInteger(Number(snapshot.currentQuestion)) ? Number(snapshot.currentQuestion) : null,
    request: snapshot.request && typeof snapshot.request === 'object' ? snapshot.request : null,
    device: snapshot.device && typeof snapshot.device === 'object' ? snapshot.device : null,
  };
}

function parseJsonField(value, fallbackValue) {
  if (value == null || value === '') {
    return fallbackValue;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallbackValue;
  }
}

function mapPaymentSessionRow(row) {
  return {
    id: Number(row.id),
    tgUserId: Number(row.tgUserId || 0),
    tgUsername: row.tgUsername || null,
    targetCode: row.targetCode,
    questionCount: Number(row.questionCount || 0),
    amountMinor: Number(row.amountMinor || 0),
    status: row.status,
    createdAt: Number(row.createdAt || 0),
    expiresAt: Number(row.expiresAt || 0),
    confirmedAt: row.confirmedAt ? Number(row.confirmedAt) : null,
    matchedStatementId: row.matchedStatementId || null,
    cancelReason: row.cancelReason || null,
  };
}
