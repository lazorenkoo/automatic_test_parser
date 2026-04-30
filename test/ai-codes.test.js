import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

test('finalizing an AI draft links the consumed code without charging twice', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdmu-ai-codes-'));
  process.env.DATA_DIR = dataDir;

  const db = await import(`../src/db.js?aiCodes=${Date.now()}`);
  const code = db.createAccessCodes(1, 'ai-balance-test', {
    siteType: null,
    clientTgUsername: '@ivan',
    expectedQuestionCount: 1,
    remainingQuestionCount: 1,
    price: 0,
  })[0];

  const before = db.inspectAccessCode(code);
  assert.equal(before.remainingQuestionCount, 1);
  assert.equal(before.consumedQuestionCount, 0);

  const consumed = db.consumeAccessCodeQuestions(code, 1);
  assert.ok(consumed);
  assert.equal(consumed.remainingQuestionCount, 0);
  assert.equal(consumed.consumedQuestions, 1);

  const draft = db.createQuizDraft({
    title: 'AI Draft',
    courseNumber: 1,
    sourceFilename: 'ai.txt',
    answerIndex: 0,
    requestedCount: 1,
    questions: [
      {
        q: 'AI question?',
        options: ['A', 'B', 'C', 'D', 'E'],
        correctIndex: 0,
      },
    ],
    reviewBlocks: [],
    rawModelJson: {
      answerMode: 'openai-double-check',
      aiPrimaryModel: 'test-model',
      aiRequireCode: true,
    },
  });

  const reservation = db.reserveAccessCode(code);
  assert.ok(reservation?.reservationToken);

  const savedQuiz = db.finalizeQuizFromDraftReservation({
    reservationToken: reservation.reservationToken,
    draftToken: draft.draftToken,
  });

  const after = db.inspectAccessCode(code);
  assert.equal(after.remainingQuestionCount, 0);
  assert.equal(after.consumedQuestionCount, 1);
  assert.equal(after.usedByQuizId, savedQuiz.id);

  const savedQuizRow = db.getQuizBySlug(savedQuiz.slug);
  assert.equal(savedQuizRow.codeId, after.id);
  assert.equal(savedQuizRow.clientTgUsername, '@ivan');
});
