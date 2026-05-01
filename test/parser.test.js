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

test('keeps lowercase continuation lines inside the next unnumbered question block', async () => {
  const sourceText = [
    'First question about a bronchodilator:',
    'Option A',
    'Option B',
    'Option C',
    'Option D',
    'Option E',
    'In the pulmonology ward the patient with obstructive bronchitis and spasmodic',
    'component was prescribed a bronchodilator whose therapeutic effect is caused by',
    'stimulation of beta2-adrenoceptors in the smooth muscles of the bronchi. Determine this',
    'drug:',
    'Salbutamol',
    'Cromolyn sodium',
    'Euphyllin',
    'Metacin',
    'Prednisolone',
  ].join('\n');

  const result = await parseQuizFromFile({
    buffer: Buffer.from(sourceText, 'utf8'),
    filename: 'sequential-lowercase-continuation.txt',
    answerIndex: 1,
    optionCount: 5,
  });

  assert.equal(result.questions.length, 2);
  assert.equal(
    result.questions[1].q,
    'In the pulmonology ward the patient with obstructive bronchitis and spasmodic component was prescribed a bronchodilator whose therapeutic effect is caused by stimulation of beta2-adrenoceptors in the smooth muscles of the bronchi. Determine this drug:',
  );
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

test('keeps hyphenated LDH-1 continuation inside the same PDF block', () => {
  const pageText = [
    '481. First question',
    'Option 481A',
    '482. Second question',
    'Option 482A',
    '486. Blood test shows increased MB-CK and LDH-',
    '1. What pathology does this indicate?',
    'Myocardial infarction',
    '487. Following question',
    'Option 487A',
  ].join('\n');

  const rebuilt = __test__.rebuildPdfPageTextForReadingOrder(pageText);
  const rebuiltLines = rebuilt.split('\n');

  assert.ok(rebuiltLines.indexOf('486. Blood test shows increased MB-CK and LDH-') >= 0);
  assert.ok(rebuiltLines.indexOf('1. What pathology does this indicate?') > rebuiltLines.indexOf('486. Blood test shows increased MB-CK and LDH-'));
  assert.ok(rebuiltLines.indexOf('1. What pathology does this indicate?') < rebuiltLines.indexOf('487. Following question'));
});

test('repairs a leaked first answer that was appended to the question text', () => {
  const repaired = __test__.repairEmbeddedQuestionLeaks([
    {
      q: '45. Which acid forms thromboxane A2? Arachidonic acid',
      options: ['Acetic acid', 'Glutamic acid', 'Malonic acid', 'Homogentisic acid'],
      correctIndex: 0,
    },
  ], 5);

  assert.equal(repaired.questions.length, 1);
  assert.equal(repaired.questions[0].q, '45. Which acid forms thromboxane A2?');
  assert.deepEqual(
    repaired.questions[0].options,
    ['Arachidonic acid', 'Acetic acid', 'Glutamic acid', 'Malonic acid', 'Homogentisic acid'],
  );
});

test('keeps wrapped option lines together in numbered blocks', async () => {
  const sourceText = [
    '1. A patient takes low-dose aspirin that inhibits thromboxane A2 synthesis.',
    'Which acid is used to form thromboxane A2?',
    'Arachidonic',
    'Acetic',
    'Glutamic',
    'Malonic',
    'Homogentisic',
    '2. Central amino acid metabolism in nervous tissue depends on glutamate because it:',
    'Binds ammonia with formation',
    'of glutamine',
    'Is used for ketone body synthesis',
    'Is used for glucose synthesis',
    'Is used for neural protein synthesis',
    'Is used for drug synthesis',
  ].join('\n');

  const result = await parseQuizFromFile({
    buffer: Buffer.from(sourceText, 'utf8'),
    filename: 'wrapped-options.txt',
    answerIndex: 1,
    optionCount: 5,
  });

  assert.equal(result.questions.length, 2);
  assert.equal(
    result.questions[0].q,
    '1. A patient takes low-dose aspirin that inhibits thromboxane A2 synthesis. Which acid is used to form thromboxane A2?',
  );
  assert.deepEqual(
    result.questions[0].options,
    ['Arachidonic', 'Acetic', 'Glutamic', 'Malonic', 'Homogentisic'],
  );
  assert.deepEqual(
    result.questions[1].options,
    [
      'Binds ammonia with formation of glutamine',
      'Is used for ketone body synthesis',
      'Is used for glucose synthesis',
      'Is used for neural protein synthesis',
      'Is used for drug synthesis',
    ],
  );
});

test('treats hyphenated page-break numeric fragments as part of the current question', async () => {
  const sourceText = [
    '485. Попереднє питання?',
    'A',
    'B',
    'C',
    'D',
    'E',
    '486. Під час дослідження крові',
    'пацієнта виявлено значне',
    'збільшення активності МВ-фракції',
    'КФК та ЛДГ-',
    '1. Про виникнення якої патології це',
    'може свідчити?',
    'Інфаркту міокарда',
    'Панкреатиту',
    'Ревматизму',
    'Холециститу',
    'Гепатиту',
    '487. Наступне питання?',
    'AA',
    'BB',
    'CC',
    'DD',
    'EE',
  ].join('\n');

  const result = await parseQuizFromFile({
    buffer: Buffer.from(sourceText, 'utf8'),
    filename: 'hyphen-break.txt',
    answerIndex: 1,
    optionCount: 5,
  });

  assert.equal(result.questions.length, 3);
  assert.equal(
    result.questions[1].q,
    '486. Під час дослідження крові пацієнта виявлено значне збільшення активності МВ-фракції КФК та ЛДГ-1. Про виникнення якої патології це може свідчити?',
  );
  assert.deepEqual(
    result.questions[1].options,
    ['Інфаркту міокарда', 'Панкреатиту', 'Ревматизму', 'Холециститу', 'Гепатиту'],
  );
});

test('splits an embedded next question number into a separate numbered block', async () => {
  const sourceText = [
    '489. Пацієнт віком 32 роки має гемоглобін 110 г/л, загальний білок 50 г/л. 490. Яка зміна є найбільш імовірною?',
    'Гіпопротеїнемія',
    'Лейкоцитоз',
    'Анасарка',
    'Анемія',
    'Гіперазотемія',
    '491. Біотин бере участь у якому типі реакцій?',
    'Карбоксилюванні',
    'Трансамінуванні',
    'Гідроксилюванні',
    'Дезамінуванні',
    'Декарбоксилюванні',
  ].join('\n');

  const result = await parseQuizFromFile({
    buffer: Buffer.from(sourceText, 'utf8'),
    filename: 'embedded-number.txt',
    answerIndex: 1,
    optionCount: 5,
  });

  assert.equal(result.questions.length, 3);
  assert.equal(
    result.questions[0].q,
    '489. Пацієнт віком 32 роки має гемоглобін 110 г/л, загальний білок 50 г/л. Яка зміна є найбільш імовірною?',
  );
  assert.equal(
    result.questions[1].q,
    '490. Яка зміна є найбільш імовірною?',
  );
  assert.deepEqual(
    result.questions[1].options,
    ['Гіпопротеїнемія', 'Лейкоцитоз', 'Анасарка', 'Анемія', 'Гіперазотемія'],
  );
  assert.equal(
    result.questions[2].q,
    '491. Біотин бере участь у якому типі реакцій?',
  );
});

test('parses sequential unnumbered question blocks across page-style breaks', async () => {
  const sourceText = [
    'ЗМ 1-4.',
    'Хворому з артритом призначено протизапальний засіб з групи селективних інгібіторів',
    'ЦОГ-2. Вказати обраний препарат:',
    'Целекоксиб',
    'Анальгін',
    'Індометацин',
    'Бутадіон',
    'Димексид',
    'У зв\'язку з вираженим больовим синдромом хворому призначений наркотичний',
    'анальгетик. Вказати обраний препарат:',
    'Морфін',
    'Індометацин',
    'Анальгін',
    'Димексид',
    'Німесулід',
  ].join('\n');

  const result = await parseQuizFromFile({
    buffer: Buffer.from(sourceText, 'utf8'),
    filename: 'sequential-unnumbered.txt',
    answerIndex: 1,
    optionCount: 5,
  });

  assert.equal(result.questions.length, 2);
  assert.equal(
    result.questions[0].q,
    'Хворому з артритом призначено протизапальний засіб з групи селективних інгібіторів ЦОГ-2. Вказати обраний препарат:',
  );
  assert.deepEqual(
    result.questions[0].options,
    ['Целекоксиб', 'Анальгін', 'Індометацин', 'Бутадіон', 'Димексид'],
  );
  assert.equal(
    result.questions[1].q,
    'У зв\'язку з вираженим больовим синдромом хворому призначений наркотичний анальгетик. Вказати обраний препарат:',
  );
});
