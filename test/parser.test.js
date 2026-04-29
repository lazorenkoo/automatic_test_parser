import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuizFromFile, __test__ } from '../src/parser.js';

test('pads a missing fixed answer option with an empty string', async () => {
  const sourceText = [
    '1. Which option is missing?',
    'Alpha',
    'Beta',
    'Gamma',
    'Delta',
  ].join('\n');

  const result = await parseQuizFromFile({
    buffer: Buffer.from(sourceText, 'utf8'),
    filename: 'quiz.txt',
    answerIndex: 5,
    optionCount: 5,
  });

  assert.equal(result.questions.length, 1);
  assert.deepEqual(result.questions[0].options, ['Alpha', 'Beta', 'Gamma', 'Delta', '']);
  assert.equal(result.questions[0].correctIndex, 4);
});

test('reorders interleaved PDF question blocks back into numeric reading order', () => {
  const pageText = [
    '17. Left column question',
    'Option 17A',
    '20. Right column question',
    'Option 20A',
    '18. Left column next question',
    'Option 18A',
    '21. Right column next question',
    'Option 21A',
  ].join('\n');

  const rebuilt = __test__.rebuildPdfPageTextForReadingOrder(pageText);
  const rebuiltLines = rebuilt.split('\n');

  assert.deepEqual(
    rebuiltLines.filter((line) => /^\d+\./.test(line)),
    [
      '17. Left column question',
      '18. Left column next question',
      '20. Right column question',
      '21. Right column next question',
    ],
  );
});
