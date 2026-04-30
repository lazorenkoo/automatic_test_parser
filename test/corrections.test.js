import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

test('persists quiz corrections in sqlite', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdmu-corrections-'));
  process.env.DATA_DIR = dataDir;

  const db = await import(`../src/db.js?corrections=${Date.now()}`);
  const code = db.createAccessCodes(1, 'correction-test')[0];
  const draft = db.createQuizDraft({
    title: 'Correction Persistence',
    courseNumber: 1,
    sourceFilename: 'correction.txt',
    answerIndex: 1,
    requestedCount: 1,
    questions: [
      {
        q: 'Original question?',
        options: ['Original A', 'Original B', 'Original C', 'Original D', 'Original E'],
        correctIndex: 0,
      },
    ],
    reviewBlocks: [],
    rawModelJson: { parser: 'test' },
  });

  const reservation = db.reserveAccessCode(code);
  assert.ok(reservation?.reservationToken);

  const savedQuiz = db.finalizeQuizFromDraftReservation({
    reservationToken: reservation.reservationToken,
    draftToken: draft.draftToken,
  });

  const updatedQuiz = db.applyQuizQuestionCorrection({
    quizId: savedQuiz.id,
    questionIndex: 1,
    question: {
      q: 'Edited question?',
      options: ['Edited A', 'Edited B', 'Edited C', 'Edited D', 'Edited E'],
      correctIndex: 0,
      manuallyCorrected: true,
    },
    correction: {
      sourceQuestionNumber: 1,
      visibleQuestionNumber: 1,
      configuredOptionCount: 5,
      shuffleQuestions: false,
      shuffledOptionOrder: [1, 2, 3, 4, 5],
      visibleOptionSourceOrder: [1, 2, 3, 4, 5],
      originalQuestionText: 'Original question?',
      editedQuestionText: 'Edited question?',
      originalOptionsSourceOrder: ['Original A', 'Original B', 'Original C', 'Original D', 'Original E'],
      editedOptionsVisibleOrder: ['Edited A', 'Edited B', 'Edited C', 'Edited D', 'Edited E'],
      editedOptionsSourceOrder: ['Edited A', 'Edited B', 'Edited C', 'Edited D', 'Edited E'],
    },
  });

  assert.equal(updatedQuiz.questions[0].q, 'Edited question?');

  const rereadQuiz = db.getQuizBySlug(savedQuiz.slug);
  assert.equal(rereadQuiz.questions[0].q, 'Edited question?');
  assert.deepEqual(
    rereadQuiz.questions[0].options,
    ['Edited A', 'Edited B', 'Edited C', 'Edited D', 'Edited E'],
  );
  assert.equal(rereadQuiz.questions[0].manuallyCorrected, true);
});
