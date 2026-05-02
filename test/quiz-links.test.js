import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

test('finalized quiz is linked to telegram username and browser device while active', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdmu-quiz-links-'));
  process.env.DATA_DIR = dataDir;

  const db = await import(`../src/db.js?quizLinks=${Date.now()}`);
  const code = db.createAccessCodes(1, 'quiz-links-test', {
    siteType: null,
    clientTgUsername: '@fallbackuser',
    expectedQuestionCount: 1,
    remainingQuestionCount: 1,
    price: 0,
  })[0];

  const draft = db.createQuizDraft({
    title: 'Linked quiz',
    courseNumber: 3,
    sourceFilename: 'linked.pdf',
    answerIndex: 1,
    requestedCount: 1,
    questions: [
      {
        q: 'Question?',
        options: ['A', 'B', 'C', 'D', 'E'],
        correctIndex: 1,
      },
    ],
    reviewBlocks: [],
    rawModelJson: {
      answerMode: 'manual',
    },
  });

  const reservation = db.reserveAccessCode(code);
  assert.ok(reservation?.reservationToken);

  const savedQuiz = db.finalizeQuizFromDraftReservation({
    reservationToken: reservation.reservationToken,
    draftToken: draft.draftToken,
    clientTgUsername: '@realowner',
    creatorSnapshot: {
      browserId: 'browser-123',
      fingerprint: 'fingerprint-123',
      userAgent: 'node-test',
    },
  });

  assert.equal(savedQuiz.clientTgUsername, '@realowner');

  const savedQuizRow = db.getQuizBySlug(savedQuiz.slug);
  assert.equal(savedQuizRow.clientTgUsername, '@realowner');
  assert.equal(savedQuizRow.creatorSnapshot?.browserId, 'browser-123');

  const byUsername = db.listActiveQuizzesByClientUsername('@realowner');
  assert.equal(byUsername.length, 1);
  assert.equal(byUsername[0].slug, savedQuiz.slug);
  assert.equal(byUsername[0].title, 'Linked quiz');

  const byBrowser = db.listActiveQuizzesByBrowserId('browser-123');
  assert.equal(byBrowser.length, 1);
  assert.equal(byBrowser[0].slug, savedQuiz.slug);
  assert.equal(byBrowser[0].clientTgUsername, '@realowner');

  const afterExpiryByUsername = db.listActiveQuizzesByClientUsername('@realowner', savedQuiz.expiresAt + 1);
  assert.equal(afterExpiryByUsername.length, 0);

  const afterExpiryByBrowser = db.listActiveQuizzesByBrowserId('browser-123', savedQuiz.expiresAt + 1);
  assert.equal(afterExpiryByBrowser.length, 0);
});

test('device remembers the latest telegram username only for future quizzes', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdmu-device-links-'));
  process.env.DATA_DIR = dataDir;

  const db = await import(`../src/db.js?deviceLinks=${Date.now()}`);
  const browserId = 'browser-rebind-1';

  function createDraft(title) {
    return db.createQuizDraft({
      title,
      courseNumber: 4,
      sourceFilename: `${title}.pdf`,
      answerIndex: 0,
      requestedCount: 1,
      questions: [
        {
          q: `${title}?`,
          options: ['A', 'B', 'C', 'D', 'E'],
          correctIndex: 0,
        },
      ],
      reviewBlocks: [],
      rawModelJson: {
        answerMode: 'manual',
      },
    });
  }

  function createCode(label) {
    return db.createAccessCodes(1, label, {
      siteType: null,
      expectedQuestionCount: 1,
      remainingQuestionCount: 1,
      price: 0,
    })[0];
  }

  function finalizeWithCode({ code, draftToken, clientTgUsername = null }) {
    const reservation = db.reserveAccessCode(code);
    assert.ok(reservation?.reservationToken);
    return db.finalizeQuizFromDraftReservation({
      reservationToken: reservation.reservationToken,
      draftToken,
      clientTgUsername,
      creatorSnapshot: {
        browserId,
        userAgent: 'node-test',
      },
    });
  }

  const firstQuiz = finalizeWithCode({
    code: createCode('device-link-a'),
    draftToken: createDraft('First quiz').draftToken,
    clientTgUsername: '@firstuser',
  });
  assert.equal(firstQuiz.clientTgUsername, '@firstuser');
  assert.equal(db.getRememberedClientUsernameByBrowserId(browserId), '@firstuser');

  const secondQuiz = finalizeWithCode({
    code: createCode('device-link-b'),
    draftToken: createDraft('Second quiz').draftToken,
  });
  assert.equal(secondQuiz.clientTgUsername, '@firstuser');

  const thirdQuiz = finalizeWithCode({
    code: createCode('device-link-c'),
    draftToken: createDraft('Third quiz').draftToken,
    clientTgUsername: '@seconduser',
  });
  assert.equal(thirdQuiz.clientTgUsername, '@seconduser');
  assert.equal(db.getRememberedClientUsernameByBrowserId(browserId), '@seconduser');

  const fourthQuiz = finalizeWithCode({
    code: createCode('device-link-d'),
    draftToken: createDraft('Fourth quiz').draftToken,
  });
  assert.equal(fourthQuiz.clientTgUsername, '@seconduser');

  assert.equal(db.getQuizBySlug(firstQuiz.slug).clientTgUsername, '@firstuser');
  assert.equal(db.getQuizBySlug(secondQuiz.slug).clientTgUsername, '@firstuser');
  assert.equal(db.getQuizBySlug(thirdQuiz.slug).clientTgUsername, '@seconduser');
  assert.equal(db.getQuizBySlug(fourthQuiz.slug).clientTgUsername, '@seconduser');
});
