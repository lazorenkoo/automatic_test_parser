import path from 'node:path';
import { createRequire } from 'node:module';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { normalizeUploadedFilename, sanitizeText } from './utils.js';

const require = createRequire(import.meta.url);
const WordExtractor = require('word-extractor');

const extractor = new WordExtractor();

export const SUPPORTED_UPLOAD_EXTENSIONS = ['.txt', '.pdf', '.doc', '.docx', '.json'];
export const SUPPORTED_ANSWER_EXTENSIONS = ['.txt', '.pdf', '.doc', '.docx'];

const LATIN_MARKERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const CYRILLIC_MARKERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К'];
const PRIVATE_USE_SYMBOLS = /^[\uE000-\uF8FF•·▪●◆■□◦○]+$/u;
const DASH_CHARS = '-–—';

export async function parseQuizFromFile({
  buffer,
  filename,
  answerIndex,
  limit,
  optionCount,
  answerKey = null,
}) {
  const effectiveLimit = normalizeQuestionLimit(limit);
  const extension = path.extname(filename || '').toLowerCase();

  if (extension === '.json') {
    return parseQuizFromJsonFile({
      buffer,
      filename,
      answerIndex,
      limit,
      optionCount,
    });
  }

  const extractedText = await extractTextFromFile(buffer, extension);
  const normalizedText = normalizeExtractedText(extractedText);

  if (!normalizedText) {
    throw new Error('Не удалось извлечь текст из файла.');
  }

  const lines = splitIntoLines(normalizedText);
  const paragraphs = splitIntoParagraphs(normalizedText);
  const safeAnswerIndex = Number.isInteger(answerIndex) && answerIndex >= 1 ? answerIndex : 1;

  const candidates = [
    parseQuestionsFromExplicitNumbers(lines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount }),
    parseQuestionsByDynamicScan(lines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount }),
    parseQuestionsByForwardScan(lines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount }),
    parseQuestionsFromText(lines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount }),
    parseQuestionsFromLineBlocks(lines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount }),
    parseQuestionsFromQuestionTails(lines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount }),
    parseQuestionsFromParagraphs(paragraphs, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount }),
    parseQuestionsByStride(paragraphs, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount }),
  ];

  const parsed = chooseBestParsedResult(candidates);
  if (!parsed.questions.length) {
    throw new Error(`Не удалось распарсить вопросы. Попробуйте другое количество вариантов ответа: сейчас выбрано ${optionCount}.`);
  }

  let questions = parsed.questions;
  const notes = [...parsed.notes];
  const reviewBlocks = Array.isArray(parsed.reviewBlocks) ? parsed.reviewBlocks : [];

  if (answerKey) {
    const resolved = applyAnswerKeyToQuestions(questions, answerKey);
    questions = resolved.questions;
    notes.push(...resolved.notes);
  }

  return {
    title: buildTitleFromFilename(filename),
    questions,
    extractedText: normalizedText,
    rawModelJson: {
      parser: parsed.parser,
      optionCount,
      extractedCharacters: normalizedText.length,
      acceptedQuestions: questions.length,
      droppedBlocks: parsed.droppedBlocks,
      reviewBlockCount: reviewBlocks.length,
      answerMode: answerKey ? 'file' : 'single',
    },
    notes,
    reviewBlocks,
  };
}

function parseQuizFromJsonFile({
  buffer,
  filename,
  answerIndex,
  limit,
  optionCount,
}) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(buffer).toString('utf8'));
  } catch {
    throw new Error('Could not read the JSON file.');
  }

  const effectiveLimit = normalizeQuestionLimit(limit);
  const rawQuestions = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.questions)
      ? parsed.questions
      : [];

  if (!rawQuestions.length) {
    throw new Error('JSON file does not contain questions.');
  }

  const normalizedQuestions = rawQuestions
    .map((item, index) => normalizeJsonQuestion(item, index + 1, answerIndex, optionCount))
    .filter(Boolean)
    .slice(0, effectiveLimit);

  if (!normalizedQuestions.length) {
    throw new Error('JSON file does not contain valid questions.');
  }

  const title = sanitizeText(parsed?.title || buildTitleFromFilename(filename));
  const importedOptionCount = normalizedQuestions[0]?.options?.length || optionCount || 0;

  return {
    title: title || buildTitleFromFilename(filename),
    questions: normalizedQuestions,
    extractedText: '',
    rawModelJson: {
      parser: 'json-import',
      optionCount: importedOptionCount,
      extractedCharacters: 0,
      acceptedQuestions: normalizedQuestions.length,
      droppedBlocks: 0,
      reviewBlockCount: Array.isArray(parsed?.reviewBlocks) ? parsed.reviewBlocks.length : 0,
      answerMode: 'json',
      importedFromJson: true,
    },
    notes: [],
    reviewBlocks: Array.isArray(parsed?.reviewBlocks) ? parsed.reviewBlocks : [],
  };
}

export async function parseAnswerKeyFromFile({ buffer, filename }) {
  const extension = path.extname(filename || '').toLowerCase();
  if (!SUPPORTED_ANSWER_EXTENSIONS.includes(extension)) {
    throw new Error(`Поддерживаются только файлы ответов ${SUPPORTED_ANSWER_EXTENSIONS.join(', ')}.`);
  }

  const extractedText = await extractTextFromFile(buffer, extension);
  const normalizedText = normalizeExtractedText(extractedText);
  if (!normalizedText) {
    throw new Error('Не удалось извлечь текст из файла ответов.');
  }

  const lines = String(normalizedText)
    .split('\n')
    .map((line) => cleanupLine(line))
    .filter(Boolean);

  const entries = new Map();
  let current = null;

  for (const line of lines) {
    const match = matchAnswerLineStart(line);
    if (match) {
      if (current) {
        pushAnswerEntry(entries, current.number, current.parts);
      }

      current = {
        number: match.number,
        parts: match.rest ? [match.rest] : [],
      };
      continue;
    }

    if (current) {
      current.parts.push(line);
    }
  }

  if (current) {
    pushAnswerEntry(entries, current.number, current.parts);
  }

  if (!entries.size) {
    throw new Error('Не удалось распознать структуру файла ответов.');
  }

  return {
    entries,
    extractedText: normalizedText,
  };
}

async function extractTextFromFile(buffer, extension) {
  if (extension === '.txt') {
    return Buffer.from(buffer).toString('utf8');
  }

  if (extension === '.pdf') {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text || '';
    } finally {
      await parser.destroy();
    }
  }

  if (extension === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }

  if (extension === '.doc') {
    const document = await extractor.extract(buffer);
    return document.getBody() || '';
  }

  throw new Error(`Неподдерживаемый формат файла: ${extension}`);
}

function normalizeJsonQuestion(question, index, fallbackAnswerIndex, fallbackOptionCount) {
  if (!question || typeof question !== 'object') {
    return null;
  }

  const prompt = sanitizeText(question.q || question.question || question.text || '');
  const options = Array.isArray(question.options)
    ? question.options.map((option) => sanitizeText(option)).filter(Boolean)
    : [];

  if (!prompt || options.length < 2) {
    return null;
  }

  let correctIndex = Number(question.correctIndex);
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
    const oneBased = Number(question.correctAnswerIndex);
    if (Number.isInteger(oneBased) && oneBased >= 1 && oneBased <= options.length) {
      correctIndex = oneBased - 1;
    } else {
      const fallbackOneBased = Number.isInteger(fallbackAnswerIndex) ? fallbackAnswerIndex : 1;
      correctIndex = Math.max(0, Math.min(options.length - 1, fallbackOneBased - 1));
    }
  }

  const expectedOptionCount = Number(fallbackOptionCount || 0);
  if (expectedOptionCount >= 2 && options.length !== expectedOptionCount) {
    return null;
  }

  return {
    q: prompt,
    options,
    correctIndex,
    sourceQuestionNumber: Number(question.sourceQuestionNumber || index),
  };
}

function normalizeExtractedText(text) {
  return String(text || '')
    .replace(/\u0000/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n[ ]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitIntoLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => cleanupLine(line))
    .filter((line) => !shouldIgnoreLine(line));
}

function splitIntoParagraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((part) => cleanupLine(part))
    .filter((part) => !shouldIgnoreLine(part));
}

function parseQuestionsFromText(linesInput, { answerIndex, limit, optionCount }) {
  const lines = Array.isArray(linesInput) ? linesInput : splitIntoLines(linesInput);
  const questions = [];
  const notes = [];
  const reviewBlocks = [];
  let droppedBlocks = 0;
  let current = null;

  for (const line of lines) {
    const questionMatch = matchQuestionStart(line);
    const optionMatch = matchOptionStart(line, optionCount);

    if (!current) {
      if (questionMatch) {
        current = createQuestionState(questionMatch.text);
      }
      continue;
    }

    if (questionMatch && current.options.length >= optionCount) {
      if (pushCompletedQuestion(questions, current, answerIndex, optionCount)) {
        if (questions.length >= limit) {
          break;
        }
      } else {
        droppedBlocks += 1;
        reviewBlocks.push(createReviewBlock([current.q, ...current.options], 'incomplete-line-markers'));
      }

      current = createQuestionState(questionMatch.text);
      continue;
    }

    if (optionMatch) {
      if (current.options.length < optionCount) {
        current.options.push(optionMatch.text);
        continue;
      }

      if (questionMatch) {
        if (pushCompletedQuestion(questions, current, answerIndex, optionCount)) {
          if (questions.length >= limit) {
            break;
          }
        } else {
          droppedBlocks += 1;
          reviewBlocks.push(createReviewBlock([current.q, ...current.options], 'overflow-line-markers'));
        }

        current = createQuestionState(questionMatch.text);
        continue;
      }
    }

    if (!current.options.length) {
      current.q = joinFragments(current.q, line);
    } else {
      const lastIndex = current.options.length - 1;
      current.options[lastIndex] = joinFragments(current.options[lastIndex], line);
    }
  }

  if (current && questions.length < limit) {
    if (!pushCompletedQuestion(questions, current, answerIndex, optionCount)) {
      droppedBlocks += 1;
      reviewBlocks.push(createReviewBlock([current.q, ...current.options], 'tail-line-markers'));
    }
  }

  if (droppedBlocks > 0) {
    notes.push(`Пропущено блоков из-за неполной структуры: ${droppedBlocks}.`);
  }

  notes.push(...buildLimitNote(questions.length, limit));

  return {
    parser: 'line-markers',
    questions: questions.slice(0, limit),
    notes,
    reviewBlocks,
    droppedBlocks,
    qualityScore: questions.length * 10 - droppedBlocks,
  };
}

function parseQuestionsFromExplicitNumbers(linesInput, { answerIndex, limit, optionCount }) {
  const lines = Array.isArray(linesInput) ? linesInput : splitIntoLines(linesInput);
  const blocks = [];
  let current = null;

  for (const line of lines) {
    const match = matchExplicitQuestionNumber(line);
    if (match) {
      if (current) {
        blocks.push(current);
      }

      current = {
        number: match.number,
        lines: match.text ? [match.text] : [],
      };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    blocks.push(current);
  }

  const questions = [];
  const reviewBlocks = [];
  let droppedBlocks = 0;

  for (const block of blocks) {
    const parsedBlock = parseExplicitNumberBlock(block.lines, optionCount);
    if (!parsedBlock) {
      droppedBlocks += 1;
      reviewBlocks.push(createReviewBlock(block.lines, 'explicit-number-block'));
      continue;
    }

    questions.push({
      q: parsedBlock.q,
      options: parsedBlock.options,
      correctIndex: answerIndex - 1,
    });

    if (questions.length >= limit) {
      break;
    }
  }

  const notes = [];
  if (droppedBlocks > 0) {
    notes.push(`Пропущено блоков из-за неполной структуры: ${droppedBlocks}.`);
  }
  notes.push(...buildLimitNote(questions.length, limit));

  return {
    parser: 'explicit-numbers',
    questions,
    notes,
    reviewBlocks,
    droppedBlocks,
    qualityScore: questions.length * 20 - droppedBlocks,
  };
}

function parseQuestionsByForwardScan(linesInput, { answerIndex, limit, optionCount }) {
  const lines = Array.isArray(linesInput) ? linesInput : splitIntoLines(linesInput);
  const questions = [];
  let droppedBlocks = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || shouldIgnoreLine(line) || isLikelyTopicHeading(line) || isLikelyHeadingContinuation(line)) {
      continue;
    }

    let matchedQuestion = null;

    for (let offset = 0; offset <= 6; offset += 1) {
      const endIndex = index + offset;
      const chunk = lines.slice(index, endIndex + 1).filter(Boolean);
      if (!chunk.length) {
        continue;
      }

      const tailLine = chunk.at(-1);
      const questionText = sanitizeText(chunk.join(' '));
      const questionLooksClosed = looksLikeQuestionTail(tailLine) || (/[.?:]$/.test(tailLine) && looksLikePromptSentence(questionText));
      if (!questionLooksClosed) {
        continue;
      }

      const optionBlock = collectSequentialOptions(lines, endIndex + 1, optionCount);
      if (!optionBlock) {
        continue;
      }

      if (!looksLikeRealQuestion(questionText, optionBlock.options)) {
        continue;
      }

      matchedQuestion = {
        questionText,
        options: optionBlock.options,
        nextIndex: optionBlock.nextIndex,
      };
      break;
    }

    if (!matchedQuestion) {
      continue;
    }

    questions.push({
      q: matchedQuestion.questionText,
      options: matchedQuestion.options,
      correctIndex: answerIndex - 1,
    });

    index = matchedQuestion.nextIndex - 1;
    if (questions.length >= limit) {
      break;
    }
  }

  const notes = [];
  if (droppedBlocks > 0) {
    notes.push(`Пропущено блоков из-за неполной структуры: ${droppedBlocks}.`);
  }
  notes.push(...buildLimitNote(questions.length, limit));

  return {
    parser: 'forward-scan',
    questions,
    notes,
    droppedBlocks,
    qualityScore: questions.length * 18 - droppedBlocks,
  };
}

function parseQuestionsByDynamicScan(linesInput, { answerIndex, limit, optionCount }) {
  const lines = Array.isArray(linesInput) ? linesInput : splitIntoLines(linesInput);
  const bestAt = Array.from({ length: lines.length + 1 }, () => ({
    score: 0,
    count: 0,
    pick: null,
    nextIndex: null,
  }));

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let best = {
      ...bestAt[index + 1],
      pick: null,
      nextIndex: index + 1,
    };

    const candidates = buildForwardCandidates(lines, index, optionCount);

    for (const candidate of candidates) {
      const tail = bestAt[candidate.nextIndex];
      const optionLengths = candidate.options.map((option) => option.length);
      const localScore = candidate.questionText.length + optionLengths.reduce((sum, value) => sum + value, 0);
      const total = {
        score: localScore + tail.score,
        count: 1 + tail.count,
        pick: candidate,
        nextIndex: candidate.nextIndex,
      };

      if (
        total.count > best.count ||
        (total.count === best.count && total.score > best.score)
      ) {
        best = total;
      }
    }

    bestAt[index] = best;
  }

  const questions = [];
  let index = 0;

  while (index < lines.length && questions.length < limit) {
    const current = bestAt[index];
    if (!current?.pick) {
      index += 1;
      continue;
    }

    questions.push({
      q: current.pick.questionText,
      options: current.pick.options,
      correctIndex: answerIndex - 1,
    });

    index = current.nextIndex;
  }

  const notes = buildLimitNote(questions.length, limit);

  return {
    parser: 'dynamic-scan',
    questions,
    notes,
    droppedBlocks: 0,
    qualityScore: bestAt[0].count * 24 + bestAt[0].score,
  };
}

function parseQuestionsFromLineBlocks(linesInput, { answerIndex, limit, optionCount }) {
  const lines = Array.isArray(linesInput) ? linesInput : splitIntoLines(linesInput);
  const blocks = [];
  let current = null;

  for (const line of lines) {
    const inlineMatch = matchQuestionStart(line);
    const standaloneMatch = matchStandaloneQuestionStart(line);

    if (inlineMatch || standaloneMatch) {
      if (current?.lines.length) {
        blocks.push(current);
      }

      current = {
        number: inlineMatch?.number ?? standaloneMatch.number,
        lines: [],
      };

      if (inlineMatch?.text) {
        current.lines.push(inlineMatch.text);
      }
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current?.lines.length) {
    blocks.push(current);
  }

  const questions = [];
  const reviewBlocks = [];
  let droppedBlocks = 0;

  for (const block of blocks) {
    const parsedBlock = parseLineBlock(block.lines, optionCount);
    if (!parsedBlock) {
      droppedBlocks += 1;
      reviewBlocks.push(createReviewBlock(block.lines, 'line-block'));
      continue;
    }

    questions.push({
      q: parsedBlock.q,
      options: parsedBlock.options,
      correctIndex: answerIndex - 1,
    });

    if (questions.length >= limit) {
      break;
    }
  }

  const notes = [];
  if (droppedBlocks > 0) {
    notes.push(`Пропущено блоков из-за неполной структуры: ${droppedBlocks}.`);
  }

  notes.push(...buildLimitNote(questions.length, limit));

  return {
    parser: 'line-blocks',
    questions,
    notes,
    reviewBlocks,
    droppedBlocks,
    qualityScore: questions.length * 12 - droppedBlocks,
  };
}

function parseQuestionsFromParagraphs(textInput, { answerIndex, limit, optionCount }) {
  const paragraphs = Array.isArray(textInput) ? textInput : splitIntoParagraphs(textInput);
  const questions = [];
  const notes = [];
  const reviewBlocks = [];
  let droppedBlocks = 0;

  for (let index = 0; index < paragraphs.length; index += 1) {
    const current = paragraphs[index];

    if (!looksLikeQuestionParagraph(current)) {
      continue;
    }

    const options = paragraphs.slice(index + 1, index + 1 + optionCount);
    if (options.length < optionCount) {
      droppedBlocks += 1;
      reviewBlocks.push(createReviewBlock([current, ...options], 'paragraph-short-options'));
      break;
    }

    const cleanOptions = options.map((option) => sanitizeText(option)).filter(Boolean);
    if (cleanOptions.length !== optionCount || cleanOptions.some(looksLikeQuestionParagraph)) {
      droppedBlocks += 1;
      reviewBlocks.push(createReviewBlock([current, ...options], 'paragraph-structure'));
      continue;
    }

    questions.push({
      q: sanitizeText(current),
      options: cleanOptions,
      correctIndex: answerIndex - 1,
    });

    index += optionCount;
    if (questions.length >= limit) {
      break;
    }
  }

  if (droppedBlocks > 0) {
    notes.push(`Пропущено блоков из-за неполной структуры: ${droppedBlocks}.`);
  }

  notes.push(...buildLimitNote(questions.length, limit));

  return {
    parser: 'paragraphs',
    questions,
    notes,
    reviewBlocks,
    droppedBlocks,
    qualityScore: questions.length * 8 - droppedBlocks,
  };
}

function parseQuestionsFromQuestionTails(linesInput, { answerIndex, limit, optionCount }) {
  const lines = Array.isArray(linesInput) ? linesInput : splitIntoLines(linesInput);
  const questions = [];
  const notes = [];
  const reviewBlocks = [];
  let droppedBlocks = 0;
  let currentQuestionLines = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (isLikelyTopicHeading(line)) {
      if (!currentQuestionLines.length) {
        continue;
      }
    }

    if (!currentQuestionLines.length && isLikelyHeadingContinuation(line)) {
      continue;
    }

    currentQuestionLines.push(line);
    const optionBlock = collectSequentialOptions(lines, index + 1, optionCount);
    const questionText = buildQuestionText(currentQuestionLines);
    const canCloseByPrompt = /[.?:]$/.test(line) && optionBlock && looksLikePromptSentence(questionText);

    if (!looksLikeQuestionTail(line) && !canCloseByPrompt) {
      const wrappedQuestion = tryBuildWrappedQuestion({
        lines,
        currentQuestionLines,
        currentIndex: index,
        optionCount,
      });

      if (wrappedQuestion) {
        questions.push({
          q: wrappedQuestion.questionText,
          options: wrappedQuestion.options,
          correctIndex: answerIndex - 1,
        });

        currentQuestionLines = [];
        index = wrappedQuestion.nextIndex - 1;

        if (questions.length >= limit) {
          break;
        }
      }

      continue;
    }

    if (!optionBlock) {
      droppedBlocks += 1;
      reviewBlocks.push(createReviewBlock([
        ...currentQuestionLines,
        ...lines.slice(index + 1, index + 1 + optionCount),
      ], 'question-tail-no-options'));
      currentQuestionLines = [];
      continue;
    }

    if (!questionText) {
      droppedBlocks += 1;
      reviewBlocks.push(createReviewBlock(currentQuestionLines, 'question-tail-empty-question'));
      currentQuestionLines = [];
      continue;
    }

    questions.push({
      q: questionText,
      options: optionBlock.options,
      correctIndex: answerIndex - 1,
    });

    currentQuestionLines = [];
    index = optionBlock.nextIndex - 1;

    if (questions.length >= limit) {
      break;
    }
  }

  if (droppedBlocks > 0) {
    notes.push(`Пропущено блоков из-за неполной структуры: ${droppedBlocks}.`);
  }

  notes.push(...buildLimitNote(questions.length, limit));

  return {
    parser: 'question-tails',
    questions,
    notes,
    reviewBlocks,
    droppedBlocks,
    qualityScore: questions.length * 14 - droppedBlocks,
  };
}

function tryBuildWrappedQuestion({ lines, currentQuestionLines, currentIndex, optionCount }) {
  const trailingLines = [];

  for (let offset = 1; offset <= 6; offset += 1) {
    const nextLine = lines[currentIndex + offset];
    if (!nextLine || shouldIgnoreLine(nextLine) || isLikelyTopicHeading(nextLine)) {
      break;
    }

    trailingLines.push(nextLine);
    if (!/[.?:]$/.test(nextLine)) {
      continue;
    }

    const questionText = buildQuestionText([...currentQuestionLines, ...trailingLines]);
    if (!looksLikePromptSentence(questionText)) {
      continue;
    }

    const optionBlock = collectSequentialOptions(lines, currentIndex + offset + 1, optionCount);
    if (!optionBlock) {
      continue;
    }

    return {
      questionText,
      options: optionBlock.options,
      nextIndex: optionBlock.nextIndex,
    };
  }

  return null;
}

function parseQuestionsByStride(paragraphsInput, { answerIndex, limit, optionCount }) {
  const paragraphs = Array.isArray(paragraphsInput) ? paragraphsInput : splitIntoParagraphs(paragraphsInput);
  const blockSize = optionCount + 1;

  if (paragraphs.length < blockSize) {
    return emptyParsedResult('stride', limit);
  }

  let best = { questions: [], score: -1, offset: 0 };

  for (let offset = 0; offset < Math.min(blockSize, paragraphs.length); offset += 1) {
    const questions = [];
    let score = 0;

    for (let index = offset; index + blockSize - 1 < paragraphs.length; index += blockSize) {
      const chunk = paragraphs.slice(index, index + blockSize);
      const question = sanitizeText(chunk[0]);
      const options = chunk.slice(1).map((option) => sanitizeText(option)).filter(Boolean);

      if (!question || options.length !== optionCount) {
        continue;
      }

      const chunkScore = scoreStrideChunk(question, options);
      if (chunkScore <= 0) {
        continue;
      }

      questions.push({
        q: question,
        options,
        correctIndex: answerIndex - 1,
      });
      score += chunkScore;

      if (questions.length >= limit) {
        break;
      }
    }

    if (
      questions.length > best.questions.length ||
      (questions.length === best.questions.length && score > best.score)
    ) {
      best = { questions, score, offset };
    }
  }

  const notes = [];
  if (best.questions.length && best.offset > 0) {
    notes.push(`Пропущено служебных абзацев в начале: ${best.offset}.`);
  }

  notes.push(...buildLimitNote(best.questions.length, limit));

  return {
    parser: 'stride',
    questions: best.questions,
    notes,
    droppedBlocks: 0,
    qualityScore: best.questions.length * 6 + best.score,
  };
}

function chooseBestParsedResult(candidates) {
  return candidates.reduce((best, current) => {
    if (!best) {
      return current;
    }

    if (current.questions.length > best.questions.length) {
      return current;
    }

    if (
      current.questions.length === best.questions.length &&
      (current.qualityScore || 0) > (best.qualityScore || 0)
    ) {
      return current;
    }

    return best;
  }, null);
}

function parseLineBlock(lines, optionCount) {
  const cleanLines = dedupeAdjacentLines(
    lines.map((line) => sanitizeText(line)).filter(Boolean),
  );

  if (cleanLines.length < optionCount + 1) {
    return null;
  }

  const splitIndex = findQuestionOptionBoundary(cleanLines, optionCount);
  if (splitIndex < 0) {
    return null;
  }

  const questionText = sanitizeText(cleanLines.slice(0, splitIndex + 1).join(' '));
  const options = cleanLines
    .slice(splitIndex + 1)
    .slice(0, optionCount)
    .map((line) => sanitizeText(line))
    .filter(Boolean);

  if (!questionText || options.length !== optionCount) {
    return null;
  }

  return { q: questionText, options };
}

function parseExplicitNumberBlock(lines, optionCount) {
  const cleanLines = normalizeBlockLines(lines);
  if (cleanLines.length < optionCount + 1) {
    return null;
  }

  const splitIndex = findQuestionOptionBoundary(cleanLines, optionCount);
  if (splitIndex < 0) {
    return null;
  }

  const questionText = sanitizeText(cleanLines.slice(0, splitIndex + 1).join(' '));
  const optionLines = normalizeOptionLines(cleanLines.slice(splitIndex + 1), optionCount);

  if (!questionText || optionLines.length !== optionCount) {
    return null;
  }

  return {
    q: questionText,
    options: optionLines,
  };
}

function collectSequentialOptions(lines, startIndex, optionCount) {
  return collectSequentialOptionsStrict(lines, startIndex, optionCount)
    || collectSequentialOptionsFlexible(lines, startIndex, optionCount)
    || recoverSequentialOptionsWindow(lines, startIndex, optionCount);
}

function collectSequentialOptionsStrict(lines, startIndex, optionCount) {
  const options = [];
  let index = startIndex;

  while (index < lines.length && options.length < optionCount) {
    const line = lines[index];

    if (!line || shouldIgnoreLine(line) || isLikelyTopicHeading(line)) {
      index += 1;
      continue;
    }

    const optionMatch = matchOptionStart(line, optionCount);
    if (looksLikeQuestionTail(line)) {
      return null;
    }

    if (!optionMatch && !looksLikeStandaloneOptionLine(line)) {
      return null;
    }

    const optionText = sanitizeText(optionMatch ? optionMatch.text : line);
    if (!optionText) {
      index += 1;
      continue;
    }

    options.push(optionText);
    index += 1;
  }

  if (options.length !== optionCount) {
    return null;
  }

  return {
    options,
    nextIndex: index,
  };
}

function collectSequentialOptionsFlexible(lines, startIndex, optionCount) {
  const options = [];
  let index = startIndex;
  let currentOption = '';

  while (index < lines.length) {
    const line = lines[index];

    if (!line || shouldIgnoreLine(line) || isLikelyTopicHeading(line)) {
      index += 1;
      continue;
    }

    const optionMatch = matchOptionStart(line, optionCount);
    if (!optionMatch && !currentOption && !looksLikeStandaloneOptionLine(line)) {
      break;
    }

    const optionText = sanitizeText(optionMatch ? optionMatch.text : line);
    if (!optionText) {
      index += 1;
      continue;
    }

    const looksLikeNextQuestion = looksLikeQuestionTail(optionText) && looksLikePromptSentence(optionText);
    if (looksLikeNextQuestion) {
      break;
    }

    if (!currentOption) {
      currentOption = optionText;
      index += 1;
      continue;
    }

    if (optionMatch) {
      options.push(currentOption);
      currentOption = optionText;
      index += 1;
      if (options.length >= optionCount) {
        break;
      }
      continue;
    }

    if (shouldContinueOptionText(currentOption, optionText)) {
      currentOption = joinFragments(currentOption, optionText);
      index += 1;
      continue;
    }

    options.push(currentOption);
    currentOption = optionText;
    index += 1;
    if (options.length >= optionCount) {
      break;
    }
  }

  if (currentOption && options.length < optionCount) {
    options.push(currentOption);
  }

  if (options.length !== optionCount) {
    return null;
  }

  return {
    options,
    nextIndex: index,
  };
}

function shouldContinueOptionText(currentOption, nextLine) {
  const current = sanitizeText(currentOption);
  const next = sanitizeText(nextLine);

  if (!current || !next) {
    return false;
  }

  if (/[,;:(\/\[]$/u.test(current) || new RegExp(`[${DASH_CHARS}]$`).test(current)) {
    return true;
  }

  if (/^[a-zа-яіїєґ]/u.test(next)) {
    return true;
  }

  return false;
}

function looksLikeStandaloneOptionLine(line) {
  const text = sanitizeText(line);
  if (!text) {
    return false;
  }

  if (looksLikeQuestionTail(text) && looksLikePromptSentence(text)) {
    return false;
  }

  if (/[?:]$/.test(text)) {
    return false;
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 8 && text.length <= 100) {
    return true;
  }

  if (wordCount <= 12 && text.length <= 80 && !/[.?!]$/.test(text)) {
    return true;
  }

  return false;
}

function recoverSequentialOptionsWindow(lines, startIndex, optionCount) {
  const windowEntries = [];

  for (let index = startIndex; index < lines.length && windowEntries.length < optionCount + 6; index += 1) {
    const line = lines[index];
    if (!line || shouldIgnoreLine(line) || isLikelyTopicHeading(line)) {
      continue;
    }

    windowEntries.push({
      index,
      line: sanitizeText(line),
    });
  }

  for (let takeCount = optionCount; takeCount <= Math.min(windowEntries.length, optionCount + 3); takeCount += 1) {
    const optionEntries = windowEntries.slice(0, takeCount);
    const trailingEntries = windowEntries.slice(takeCount);
    const options = partitionRecoveredOptions(optionEntries, optionCount);

    if (!options) {
      continue;
    }

    if (trailingEntries.length && !looksLikePotentialQuestionStart(trailingEntries[0], trailingEntries[1])) {
      continue;
    }

    return {
      options,
      nextIndex: trailingEntries.length ? trailingEntries[0].index : optionEntries.at(-1).index + 1,
    };
  }

  return null;
}

function partitionRecoveredOptions(entries, optionCount) {
  const memo = new Map();

  function solve(position, groupsLeft) {
    const key = `${position}:${groupsLeft}`;
    if (memo.has(key)) {
      return memo.get(key);
    }

    if (groupsLeft === 0) {
      return position === entries.length ? [] : null;
    }

    const remaining = entries.length - position;
    if (remaining < groupsLeft || remaining > groupsLeft * 3) {
      return null;
    }

    for (let groupSize = 1; groupSize <= Math.min(3, remaining); groupSize += 1) {
      const chunk = entries.slice(position, position + groupSize).map((entry) => entry.line);
      if (!isValidRecoveredOptionChunk(chunk)) {
        continue;
      }

      const optionText = sanitizeText(chunk.join(' '));
      if (!optionText || (looksLikeQuestionTail(optionText) && looksLikePromptSentence(optionText))) {
        continue;
      }

      const tail = solve(position + groupSize, groupsLeft - 1);
      if (tail) {
        const resolved = [optionText, ...tail];
        memo.set(key, resolved);
        return resolved;
      }
    }

    memo.set(key, null);
    return null;
  }

  return solve(0, optionCount);
}

function isValidRecoveredOptionChunk(chunk) {
  if (!Array.isArray(chunk) || !chunk.length) {
    return false;
  }

  if (chunk.length === 1) {
    return looksLikeStandaloneOptionLine(chunk[0]);
  }

  for (let index = 1; index < chunk.length; index += 1) {
    if (!shouldContinueOptionText(chunk[index - 1], chunk[index])) {
      return false;
    }
  }

  return true;
}

function looksLikePotentialQuestionStart(firstEntry, secondEntry) {
  const first = sanitizeText(firstEntry?.line);
  const second = sanitizeText(secondEntry?.line);

  if (!first) {
    return false;
  }

  if (looksLikeQuestionTail(first) && looksLikePromptSentence(first)) {
    return true;
  }

  if (second) {
    const combined = sanitizeText(`${first} ${second}`);
    if (looksLikePromptSentence(combined)) {
      return true;
    }
  }

  return false;
}

function dedupeAdjacentLines(lines) {
  const deduped = [];

  for (const line of lines) {
    if (deduped.at(-1) === line) {
      continue;
    }
    deduped.push(line);
  }

  return deduped;
}

function normalizeBlockLines(lines) {
  return lines
    .map((line) => sanitizeText(line))
    .filter(Boolean)
    .filter((line) => !shouldIgnoreLine(line))
    .filter((line) => !/^+$/u.test(line))
    .filter((line) => !/^[\s]+[A-ZА-ЯІЇЄҐ._-]{3,}/u.test(line))
    .filter((line) => !/^[A-ZА-ЯІЇЄҐ._-]{3,}$/.test(line))
    .reduce((acc, line) => {
      if (acc.at(-1) === line) {
        return acc;
      }
      acc.push(line);
      return acc;
    }, []);
}

function normalizeOptionLines(lines, optionCount) {
  const normalized = [];

  for (const rawLine of lines) {
    const line = sanitizeText(rawLine);
    if (!line) {
      continue;
    }

    if (shouldIgnoreLine(line)) {
      continue;
    }

    if (normalized.includes(line)) {
      continue;
    }

    normalized.push(line);
  }

  if (normalized.length > optionCount) {
    return normalized.slice(0, optionCount);
  }

  return normalized;
}

function looksLikeRealQuestion(questionText, options) {
  const normalizedQuestion = sanitizeText(questionText);
  if (!normalizedQuestion || normalizedQuestion.length < 20) {
    return false;
  }

  if (!Array.isArray(options) || !options.length) {
    return false;
  }

  const optionLengths = options.map((option) => sanitizeText(option).length).filter(Boolean);
  const longestOption = optionLengths.length ? Math.max(...optionLengths) : 0;

  if (looksLikePromptSentence(normalizedQuestion)) {
    return true;
  }

  return normalizedQuestion.length > longestOption;
}

function buildQuestionText(lines) {
  const trimmedLines = trimLeadingHeadingLines(lines);
  return sanitizeText(trimmedLines.join(' '));
}

function trimLeadingHeadingLines(linesInput) {
  const lines = Array.isArray(linesInput) ? [...linesInput] : [linesInput];

  while (lines.length) {
    const current = sanitizeText(lines[0]);
    if (!current) {
      lines.shift();
      continue;
    }

    if (
      /^змістовий модуль\b.*$/iu.test(current)
      || matchesNormalizedModuleHeading(current)
      || matchesStandaloneMetaHeading(current)
      || isLikelyTopicHeading(current)
      || isLikelyHeadingContinuation(current)
      || isLikelyStandaloneMetaHeading(current)
    ) {
      lines.shift();
      continue;
    }

    break;
  }

  return lines;
}

function buildForwardCandidates(lines, index, optionCount) {
  const line = lines[index];
  if (!line || shouldIgnoreLine(line) || isLikelyTopicHeading(line) || isLikelyHeadingContinuation(line)) {
    return [];
  }

  const candidates = [];

  for (let offset = 0; offset <= 6; offset += 1) {
    const endIndex = index + offset;
    const chunk = lines.slice(index, endIndex + 1).filter(Boolean);
    if (!chunk.length) {
      continue;
    }

    const tailLine = chunk.at(-1);
    const questionText = buildQuestionText(chunk);
    const questionLooksClosed = looksLikeQuestionTail(tailLine) || (/[.?:]$/.test(tailLine) && looksLikePromptSentence(questionText));
    if (!questionLooksClosed) {
      continue;
    }

    const optionBlock = collectSequentialOptions(lines, endIndex + 1, optionCount);
    if (!optionBlock) {
      continue;
    }

    if (!looksLikeRealQuestion(questionText, optionBlock.options)) {
      continue;
    }

    candidates.push({
      questionText,
      options: optionBlock.options,
      nextIndex: optionBlock.nextIndex,
    });
  }

  return candidates;
}

function findQuestionOptionBoundary(lines, optionCount) {
  let bestIndex = -1;

  for (let index = 0; index <= lines.length - optionCount - 1; index += 1) {
    if (!looksLikeQuestionTail(lines[index])) {
      continue;
    }

    if (lines.length - (index + 1) >= optionCount) {
      bestIndex = index;
    }
  }

  if (bestIndex >= 0) {
    return bestIndex;
  }

  if (lines.length >= optionCount + 1) {
    return lines.length - optionCount - 1;
  }

  return -1;
}

function looksLikeQuestionTail(line) {
  if (!line) {
    return false;
  }

  if (/[?:]$/.test(line)) {
    return true;
  }

  if (/\.$/.test(line) && /(який|яка|яке|які|що|хто|де|коли|чому|скільки|виберіть|вкажіть|укажіть|назвіть|визначте|з якими|для якого|до якої|про збудника якої)/i.test(line)) {
    return true;
  }

  return false;
}

function createQuestionState(initialText) {
  return {
    q: initialText,
    options: [],
  };
}

function pushCompletedQuestion(target, current, answerIndex, optionCount) {
  const questionText = sanitizeText(current.q);
  const options = current.options.map((option) => sanitizeText(option)).filter(Boolean);

  if (!questionText || options.length !== optionCount) {
    return false;
  }

  target.push({
    q: questionText,
    options,
    correctIndex: answerIndex - 1,
  });

  return true;
}

function cleanupLine(line) {
  return String(line || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}

function shouldIgnoreLine(line) {
  if (!line) {
    return true;
  }

  if (/[\uE000-\uF8FF]/u.test(line) || PRIVATE_USE_SYMBOLS.test(line)) {
    return true;
  }

  if (/^\d+$/.test(line)) {
    return true;
  }

  if (/^page\s+\d+$/i.test(line)) {
    return true;
  }

  if (/^\d+\s*\/\s*\d+$/.test(line)) {
    return true;
  }

  if (/^[-–—\s]*\d+\s+of\s+\d+[-–—\s]*$/i.test(line)) {
    return true;
  }

  const compactAscii = line.replace(/[^\p{L}\p{N}._-]+/gu, '');
  if (compactAscii && compactAscii.length >= 12 && /^[A-Z0-9._-]{12,}$/.test(compactAscii)) {
    return true;
  }

  return false;
}

function isLikelyTopicHeading(line) {
  if (!line) {
    return false;
  }

  if (/^змістовий модуль$/i.test(line)) {
    return true;
  }

  if (/^\d{1,2}\.\s+.+$/.test(line) && !looksLikeQuestionTail(line)) {
    return true;
  }

  if (/^[A-ZА-ЯІЇЄҐ0-9\s.,()/-]{8,}$/u.test(line) && !/[?:]$/.test(line)) {
    return true;
  }

  return false;
}

function matchesNormalizedModuleHeading(line) {
  return /^\u0417\u043c\u0456\u0441\u0442\u043e\u0432\u0438\u0439 \u043c\u043e\u0434\u0443\u043b\u044c\b.*$/iu.test(String(line || ''));
}

function matchesStandaloneMetaHeading(line) {
  const text = String(line || '');
  if (/^(\u0441\u043f\u0435\u0446\u0456\u0430\u043b\u044c\u043d\u0430|\u0437\u0430\u0433\u0430\u043b\u044c\u043d\u0430)\s+\u0432\u0456\u0440\u0443\u0441\u043e\u043b\u043e\u0433\u0456\u044f\.?$/iu.test(text)) {
    return true;
  }

  if (/^(\u0433\u0435\u0440\u043f\u0435\u0441\u0432\u0456\u0440\u0443\u0441\u0438|\u0440\u0435\u0442\u0440\u043e\u0432\u0456\u0440\u0443\u0441\u0438|\u043f\u0456\u043a\u043e\u0440\u043d\u0430\u0432\u0456\u0440\u0443\u0441\u0438|\u043e\u0440\u0442\u043e\u043c\u0456\u043a\u0441\u043e\u0432\u0456\u0440\u0443\u0441\u0438|\u043f\u0430\u0440\u0430\u043c\u0456\u043a\u0441\u043e\u0432\u0456\u0440\u0443\u0441\u0438)\.?$/iu.test(text)) {
    return true;
  }

  return false;
}

function isLikelyStandaloneMetaHeading(line) {
  if (!line) {
    return false;
  }

  if (/^(спеціальна|загальна)\s+вірусологія\.?$/iu.test(line)) {
    return true;
  }

  if (/^(герпесвіруси|ретровіруси|пікорнавіруси|ортоміксовіруси|параміксовіруси)\.?$/iu.test(line)) {
    return true;
  }

  return false;
}

function isLikelyHeadingContinuation(line) {
  if (!line) {
    return false;
  }

  return /^[a-zа-яіїєґ]/u.test(line) && !looksLikeQuestionTail(line);
}

function looksLikePromptSentence(text) {
  return /(який|яка|яке|які|що|хто|де|коли|чому|скільки|виберіть|вкажіть|укажіть|назвіть|визначити|визначте|оберіть|обрати|до якої|для якого|з якими|про збудника якої|яке можливе|який метод|яку інфекцію)/i.test(String(text || ''));
}

function looksLikeQuestionParagraph(line) {
  if (!line) {
    return false;
  }

  if (matchQuestionStart(line) || matchStandaloneQuestionStart(line)) {
    return true;
  }

  return looksLikeQuestionTail(line);
}

function scoreStrideChunk(question, options) {
  let score = 0;

  if (looksLikeQuestionParagraph(question)) {
    score += 4;
  }

  if (question.length >= 40) {
    score += 2;
  }

  const avgOptionLength = options.reduce((sum, option) => sum + option.length, 0) / options.length;
  if (question.length > avgOptionLength) {
    score += 2;
  }

  if (options.every((option) => option.length <= question.length * 1.2)) {
    score += 1;
  }

  return score;
}

function matchQuestionStart(line) {
  const match = line.match(/^(\d{1,3})\s*[\.\)\-–—:]\s*(.+)$/);
  if (!match) {
    return null;
  }

  return {
    number: Number(match[1]),
    text: sanitizeText(match[2]),
  };
}

function matchExplicitQuestionNumber(line) {
  const match = line.match(/^(\d{1,3})\s*[.\)\-–—:]?\s*(.*)$/);
  if (!match) {
    return null;
  }

  const number = Number(match[1]);
  if (!Number.isInteger(number) || number < 1 || number > 999) {
    return null;
  }

  return {
    number,
    text: sanitizeText(match[2]),
  };
}

function matchStandaloneQuestionStart(line) {
  const match = line.match(/^(\d{1,3})\s*[\.\)\-–—:]?$/);
  if (!match) {
    return null;
  }

  return {
    number: Number(match[1]),
  };
}

function matchOptionStart(line, optionCount) {
  const markers = [
    ...LATIN_MARKERS.slice(0, optionCount),
    ...LATIN_MARKERS.slice(0, optionCount).map((item) => item.toLowerCase()),
    ...CYRILLIC_MARKERS.slice(0, optionCount),
    ...CYRILLIC_MARKERS.slice(0, optionCount).map((item) => item.toLowerCase()),
    ...Array.from({ length: optionCount }, (_, index) => String(index + 1)),
  ];

  const escapedMarkers = markers
    .sort((a, b) => b.length - a.length)
    .map((marker) => marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  const regex = new RegExp(`^(${escapedMarkers})(\\s*[\\)\\.\\-${DASH_CHARS}:])(\\s*)(.+)$`);
  const match = line.match(regex);
  if (!match) {
    return null;
  }

  const marker = String(match[1] || '');
  const _separator = String(match[2] || '');
  const spacing = String(match[3] || '');
  const text = sanitizeText(match[4]);
  if (!text) {
    return null;
  }

  const markerIsLetter = /^[A-Za-z\u0400-\u04FF]$/u.test(marker);
  const textStartsLowercase = /^\p{Ll}/u.test(text);

  // Prevent false positives like "В-рус ..." where the first letter is part of the word,
  // not an answer marker extracted from the source file.
  if (markerIsLetter && !spacing && textStartsLowercase) {
    return null;
  }

  return {
    text,
  };
}

function joinFragments(left, right) {
  const a = sanitizeText(left);
  const b = sanitizeText(right);

  if (!a) {
    return b;
  }

  if (!b) {
    return a;
  }

  if (new RegExp(`[${DASH_CHARS}]$`).test(a)) {
    return `${a.slice(0, -1)}${b}`;
  }

  return `${a} ${b}`;
}

function emptyParsedResult(parser, limit) {
  return {
    parser,
    questions: [],
    notes: buildLimitNote(0, limit),
    reviewBlocks: [],
    droppedBlocks: 0,
    qualityScore: 0,
  };
}

function createReviewBlock(lines, reason) {
  const text = sanitizeText((Array.isArray(lines) ? lines : [lines]).filter(Boolean).join(' '));
  return {
    reason: String(reason || 'manual-review'),
    text,
  };
}

function normalizeQuestionLimit(limit) {
  if (!Number.isFinite(limit) || limit == null) {
    return Number.POSITIVE_INFINITY;
  }

  const numericLimit = Math.floor(Number(limit));
  if (!Number.isFinite(numericLimit) || numericLimit < 1) {
    return Number.POSITIVE_INFINITY;
  }

  return numericLimit;
}

function buildLimitNote(foundCount, limit) {
  if (!Number.isFinite(limit) || foundCount >= limit) {
    return [];
  }

  return [`Найдено вопросов: ${foundCount}. Запрошено: ${limit}.`];
}

function buildTitleFromFilename(filename) {
  return normalizeUploadedFilename(filename)
    .replace(/\.[^.]+$/u, '')
    .replace(/[_-]+/g, ' ')
    .trim() || 'Medical quiz';
}

function matchAnswerLineStart(line) {
  const match = line.match(/^(\d{1,4})\s*[\.\)\-–—:]?\s*(.*)$/);
  if (!match) {
    return null;
  }

  return {
    number: Number(match[1]),
    rest: sanitizeText(match[2]),
  };
}

function pushAnswerEntry(entries, questionNumber, parts) {
  const rawValue = sanitizeText(parts.join(' '));
  if (!rawValue) {
    return;
  }

  entries.set(questionNumber, parseAnswerDescriptor(rawValue));
}

function parseAnswerDescriptor(rawValue) {
  const cleaned = sanitizeText(rawValue);
  const normalized = cleaned
    .replace(/^(?:вариант|варіант|answer|ответ|відповідь)\s+/i, '')
    .trim();

  if (/^\d+$/.test(normalized)) {
    return {
      kind: 'index',
      value: Number(normalized),
      raw: cleaned,
    };
  }

  const compoundNumberMatch = normalized.match(/^\d+\.(\d+)$/);
  if (compoundNumberMatch) {
    return {
      kind: 'index',
      value: Number(compoundNumberMatch[1]),
      raw: cleaned,
    };
  }

  const markerMatch = normalized.match(/^([A-JА-Я])(?:[.)-])?$/i);
  if (markerMatch) {
    return {
      kind: 'marker',
      value: markerMatch[1],
      raw: cleaned,
    };
  }

  return {
    kind: 'text',
    value: normalized,
    raw: cleaned,
  };
}

function applyAnswerKeyToQuestions(questions, answerKey) {
  const updatedQuestions = questions.map((question) => ({
    ...question,
    correctIndex: question.correctIndex,
  }));

  const missing = [];
  const unresolved = [];

  for (let index = 0; index < updatedQuestions.length; index += 1) {
    const questionNumber = index + 1;
    const descriptor = answerKey.entries.get(questionNumber);

    if (!descriptor) {
      missing.push(questionNumber);
      continue;
    }

    const resolvedIndex = resolveAnswerDescriptor(updatedQuestions[index], descriptor);
    if (resolvedIndex < 0) {
      unresolved.push(`${questionNumber}: ${descriptor.raw}`);
      continue;
    }

    updatedQuestions[index].correctIndex = resolvedIndex;
  }

  if (missing.length || unresolved.length) {
    const parts = [];
    if (missing.length) {
      parts.push(`не найдены ответы для вопросов: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '...' : ''}`);
    }
    if (unresolved.length) {
      parts.push(`не удалось сопоставить ответы: ${unresolved.slice(0, 8).join('; ')}${unresolved.length > 8 ? '...' : ''}`);
    }

    throw new Error(`Файл ответов распознан не полностью: ${parts.join('. ')}.`);
  }

  return {
    questions: updatedQuestions,
    notes: ['Правильные ответы загружены из отдельного файла.'],
  };
}

function resolveAnswerDescriptor(question, descriptor) {
  if (descriptor.kind === 'index') {
    const numericIndex = Number(descriptor.value);
    if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= question.options.length) {
      return numericIndex - 1;
    }
    return -1;
  }

  if (descriptor.kind === 'marker') {
    return markerToIndex(descriptor.value, question.options.length);
  }

  if (descriptor.kind === 'text') {
    const normalizedTarget = normalizeAnswerText(descriptor.value);
    if (!normalizedTarget) {
      return -1;
    }

    for (let index = 0; index < question.options.length; index += 1) {
      const option = question.options[index];
      const normalizedOption = normalizeAnswerText(option);
      if (!normalizedOption) {
        continue;
      }

      if (normalizedOption === normalizedTarget) {
        return index;
      }

      if (normalizedOption.includes(normalizedTarget) || normalizedTarget.includes(normalizedOption)) {
        return index;
      }
    }
  }

  return -1;
}

function markerToIndex(marker, optionCount) {
  const normalizedMarker = String(marker || '').trim();
  if (!normalizedMarker) {
    return -1;
  }

  const latinIndex = LATIN_MARKERS.findIndex((item) => item.toLowerCase() === normalizedMarker.toLowerCase());
  if (latinIndex >= 0 && latinIndex < optionCount) {
    return latinIndex;
  }

  const cyrillicIndex = CYRILLIC_MARKERS.findIndex((item) => item.toLowerCase() === normalizedMarker.toLowerCase());
  if (cyrillicIndex >= 0 && cyrillicIndex < optionCount) {
    return cyrillicIndex;
  }

  return -1;
}

function normalizeAnswerText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[“”"'`]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
