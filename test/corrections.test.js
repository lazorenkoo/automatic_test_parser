import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { quizAppJs } from '../src/quiz-assets.js';

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

test('builds a correction payload with an added answer option', () => {
  const bootstrapQuestion = {
    q: 'Original question?',
    options: ['Original A', 'Original B', 'Original C', 'Original D', 'Original E'],
    correctIndex: 0,
  };

  const domNodes = new Map();
  const createNode = () => ({
    value: '',
    checked: false,
    disabled: false,
    innerHTML: '',
    textContent: '',
    children: [],
    dataset: {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; },
    },
    addEventListener() {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    focus() {},
  });

  const documentStub = {
    documentElement: { lang: 'uk' },
    title: '',
    getElementById(id) {
      if (!domNodes.has(id)) {
        domNodes.set(id, createNode());
      }
      return domNodes.get(id);
    },
    addEventListener() {},
  };

  const sandbox = {
    console,
    fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }),
    window: {
      QUIZ_BOOTSTRAP: {
        title: 'Correction Payload',
        quizUrl: '',
        reportUrl: '',
        correctionUrl: '/api/quizzes/test/corrections',
        configuredOptionCount: 5,
        questions: [bootstrapQuestion],
        aiDisagreements: [],
        aiSuspiciousQuestions: [],
      },
      confirm() { return true; },
      prompt() { return null; },
      clearTimeout() {},
      setTimeout() { return 0; },
      location: { href: 'http://localhost/quiz/test' },
    },
    document: documentStub,
  };

  vm.runInNewContext(
    `${quizAppJs}\n;globalThis.__test__ = { buildCorrectionPayload, state, els };`,
    sandbox,
  );

  const { buildCorrectionPayload, state, els } = sandbox.__test__;
  state.order = [0];
  state.optsOrder = [[0, 1, 2, 3, 4]];
  state.cur = 0;
  els.correctionQuestionInput.value = 'Edited question?';

  const optionInputs = [
    { value: 'Edited A', dataset: { sourceOptionIndex: '0' } },
    { value: 'Edited B', dataset: { sourceOptionIndex: '1' } },
    { value: 'Edited C', dataset: { sourceOptionIndex: '2' } },
    { value: 'Edited D', dataset: { sourceOptionIndex: '3' } },
    { value: 'Edited E', dataset: { sourceOptionIndex: '4' } },
    { value: 'Edited F', dataset: { sourceOptionIndex: '' } },
  ];
  els.correctionOptions.querySelectorAll = () => optionInputs;

  const correction = buildCorrectionPayload();
  assert.ok(correction);
  assert.equal(correction.configuredOptionCount, 6);
  assert.deepEqual(
    Array.from(correction.visibleOptionSourceOrder),
    [1, 2, 3, 4, 5, null],
  );
  assert.equal(correction.editedOptionsSourceOrder, null);
  assert.deepEqual(
    Array.from(correction.editedOptionsVisibleOrder),
    ['Edited A', 'Edited B', 'Edited C', 'Edited D', 'Edited E', 'Edited F'],
  );
});

test('persists quiz corrections with an added answer option in sqlite', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdmu-corrections-extra-option-'));
  process.env.DATA_DIR = dataDir;

  const db = await import(`../src/db.js?correctionsExtra=${Date.now()}`);
  const code = db.createAccessCodes(1, 'correction-extra-option-test')[0];
  const draft = db.createQuizDraft({
    title: 'Correction Extra Option',
    courseNumber: 1,
    sourceFilename: 'correction-extra.txt',
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
      options: ['Edited A', 'Edited B', 'Edited C', 'Edited D', 'Edited E', 'Edited F'],
      correctIndex: 0,
      manuallyCorrected: true,
    },
    correction: {
      sourceQuestionNumber: 1,
      visibleQuestionNumber: 1,
      configuredOptionCount: 6,
      shuffleQuestions: false,
      shuffledOptionOrder: [1, 2, 3, 4, 5],
      visibleOptionSourceOrder: [1, 2, 3, 4, 5, null],
      originalQuestionText: 'Original question?',
      editedQuestionText: 'Edited question?',
      originalOptionsSourceOrder: ['Original A', 'Original B', 'Original C', 'Original D', 'Original E'],
      editedOptionsVisibleOrder: ['Edited A', 'Edited B', 'Edited C', 'Edited D', 'Edited E', 'Edited F'],
      editedOptionsSourceOrder: null,
    },
  });

  assert.deepEqual(
    updatedQuiz.questions[0].options,
    ['Edited A', 'Edited B', 'Edited C', 'Edited D', 'Edited E', 'Edited F'],
  );

  const rereadQuiz = db.getQuizBySlug(savedQuiz.slug);
  assert.deepEqual(
    rereadQuiz.questions[0].options,
    ['Edited A', 'Edited B', 'Edited C', 'Edited D', 'Edited E', 'Edited F'],
  );
  assert.equal(rereadQuiz.questions[0].manuallyCorrected, true);
});

test('migrates legacy quiz_corrections schema before saving corrections', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdmu-corrections-legacy-'));
  process.env.DATA_DIR = dataDir;

  const legacyDb = new DatabaseSync(path.join(dataDir, 'pdmu.sqlite'));
  legacyDb.exec(`
    CREATE TABLE quiz_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id INTEGER NOT NULL,
      question_index INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  legacyDb.close();

  const db = await import(`../src/db.js?correctionsLegacy=${Date.now()}`);
  const code = db.createAccessCodes(1, 'correction-legacy-test')[0];
  const draft = db.createQuizDraft({
    title: 'Correction Legacy Migration',
    courseNumber: 1,
    sourceFilename: 'correction-legacy.txt',
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
});
