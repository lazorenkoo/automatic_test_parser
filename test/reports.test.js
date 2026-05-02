import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

test('reports require a non-empty note', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdmu-reports-'));
  process.env.DATA_DIR = dataDir;

  const db = await import(`../src/db.js?reports=${Date.now()}`);
  const code = db.createAccessCodes(1, 'report-balance-test', {
    siteType: null,
    expectedQuestionCount: 1,
    remainingQuestionCount: 1,
    price: 0,
  })[0];
  const reservation = db.reserveAccessCode(code);
  assert.ok(reservation?.reservationToken);

  const draft = db.createQuizDraft({
    title: 'Reported quiz',
    courseNumber: 1,
    sourceFilename: 'report.txt',
    answerIndex: 1,
    requestedCount: 1,
    questions: [
      {
        q: 'Question?',
        options: ['A', 'B', 'C', 'D', 'E'],
        correctIndex: 0,
      },
    ],
    reviewBlocks: [],
    rawModelJson: {},
  });

  const quiz = db.finalizeQuizFromDraftReservation({
    reservationToken: reservation.reservationToken,
    draftToken: draft.draftToken,
  });

  assert.equal(db.createQuizReport({ quizId: quiz.id, note: '' }), null);
  assert.equal(db.createQuizReport({ quizId: quiz.id, note: '   ' }), null);
  assert.equal(db.createUploadReport({ title: 'Upload report', note: '' }), null);
  assert.ok(db.createQuizReport({ quizId: quiz.id, note: 'Wrong answer in question 1' }));
});
