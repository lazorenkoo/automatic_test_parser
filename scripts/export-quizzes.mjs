import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = path.resolve(process.env.DATA_DIR || './data');
const dbPath = path.join(dataDir, 'pdmu.sqlite');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = path.resolve(process.argv[2] || `./exports/quizzes-${timestamp}`);

if (!fs.existsSync(dbPath)) {
  console.error(`SQLite file not found: ${dbPath}`);
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

const db = new DatabaseSync(dbPath, { readonly: true });

const quizzes = db.prepare(`
  SELECT
    id,
    slug,
    title,
    course_number,
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
    banned_at,
    code_id
  FROM quizzes
  ORDER BY created_at ASC, id ASC
`).all();

const drafts = db.prepare(`
  SELECT
    id,
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
  FROM quiz_drafts
  ORDER BY created_at ASC, id ASC
`).all();

const quizDir = path.join(outputDir, 'quizzes');
const draftDir = path.join(outputDir, 'drafts');
fs.mkdirSync(quizDir, { recursive: true });
fs.mkdirSync(draftDir, { recursive: true });

for (const row of quizzes) {
  const fileName = buildFileName(row.slug || row.title || `quiz-${row.id}`);
  const payload = {
    type: 'quiz',
    id: row.id,
    slug: row.slug,
    title: row.title,
    courseNumber: Number(row.course_number || 0),
    sourceFilename: row.source_filename || null,
    answerIndex: Number(row.answer_index || 0),
    requestedCount: Number(row.requested_count || 0),
    parsedCount: Number(row.parsed_count || 0),
    questions: parseJson(row.questions_json, []),
    reviewBlocks: parseJson(row.review_blocks_json, []),
    rawModelJson: parseJson(row.raw_model_json, {}),
    creatorSnapshot: parseJson(row.creator_snapshot_json, {}),
    sourceUploadPath: row.source_upload_path || null,
    sourceUploadName: row.source_upload_name || null,
    answerUploadPath: row.answer_upload_path || null,
    answerUploadName: row.answer_upload_name || null,
    createdAt: Number(row.created_at || 0),
    expiresAt: row.expires_at ? Number(row.expires_at) : null,
    bannedAt: row.banned_at ? Number(row.banned_at) : null,
    codeId: Number(row.code_id || 0),
  };

  fs.writeFileSync(
    path.join(quizDir, fileName),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
}

for (const row of drafts) {
  const fileName = buildFileName(row.draft_token || row.title || `draft-${row.id}`);
  const payload = {
    type: 'draft',
    id: row.id,
    draftToken: row.draft_token,
    title: row.title,
    courseNumber: Number(row.course_number || 0),
    sourceFilename: row.source_filename || null,
    answerIndex: Number(row.answer_index || 0),
    requestedCount: Number(row.requested_count || 0),
    parsedCount: Number(row.parsed_count || 0),
    questions: parseJson(row.questions_json, []),
    reviewBlocks: parseJson(row.review_blocks_json, []),
    rawModelJson: parseJson(row.raw_model_json, {}),
    sourceUploadPath: row.source_upload_path || null,
    sourceUploadName: row.source_upload_name || null,
    answerUploadPath: row.answer_upload_path || null,
    answerUploadName: row.answer_upload_name || null,
    createdAt: Number(row.created_at || 0),
  };

  fs.writeFileSync(
    path.join(draftDir, fileName),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
}

const manifest = {
  dbPath,
  outputDir,
  exportedAt: new Date().toISOString(),
  quizzes: quizzes.length,
  drafts: drafts.length,
};

fs.writeFileSync(
  path.join(outputDir, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);

console.log(`Exported ${quizzes.length} quizzes and ${drafts.length} drafts to ${outputDir}`);

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function buildFileName(value) {
  const safe = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 120);

  return `${safe || 'item'}.json`;
}
