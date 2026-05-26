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
const AUTO_OPTION_COUNT = 'auto';
const AUTO_OPTION_MIN = 2;
const AUTO_OPTION_MAX = 6;

export async function parseQuizFromFile({
  buffer,
  filename,
  answerIndex,
  limit,
  optionCount,
  answerKey = null,
  preferDocxFixedAuto = true,
}) {
  const effectiveLimit = normalizeQuestionLimit(limit);
  const extension = path.extname(filename || '').toLowerCase();
  const normalizedOptionCount = normalizeOptionCountSetting(optionCount);
  let fixedDocxResult = null;

  if (preferDocxFixedAuto && (extension === '.docx' || extension === '.pdf') && normalizedOptionCount === AUTO_OPTION_COUNT) {
    try {
      fixedDocxResult = await parseQuizFromFile({
        buffer,
        filename,
        answerIndex,
        limit,
        optionCount: 5,
        answerKey,
        preferDocxFixedAuto: false,
      });
    } catch {
      fixedDocxResult = null;
    }
  }

  if (extension === '.json') {
    return parseQuizFromJsonFile({
      buffer,
      filename,
      answerIndex,
      limit,
      optionCount: normalizedOptionCount,
    });
  }

  const extractedText = await extractTextFromFile(buffer, extension);
  const normalizedText = normalizeExtractedText(extractedText);

  if (!normalizedText) {
    throw new Error('Не удалось извлечь текст из файла.');
  }

  const lines = splitIntoLines(normalizedText);
  const paragraphs = splitIntoParagraphs(normalizedText);
  const rawLines = String(normalizedText || '').split('\n').map((line) => cleanupLine(line));
  const safeAnswerIndex = Number.isInteger(answerIndex) && answerIndex >= 1 ? answerIndex : 1;
  const paragraphMarkersCandidate = parseQuestionsFromParagraphMarkers(paragraphs, {
    answerIndex: safeAnswerIndex,
    limit: effectiveLimit,
    optionCount: normalizedOptionCount,
  });
  const exactParagraphCandidate = parseQuestionsFromExactParagraphBlocks(paragraphs, {
    answerIndex: safeAnswerIndex,
    limit: effectiveLimit,
    optionCount: normalizedOptionCount,
  });

  if (shouldPreferExactParagraphBlocks(extension, paragraphs, exactParagraphCandidate, normalizedOptionCount)) {
    let questions = normalizeParsedQuestionsForOutput(exactParagraphCandidate.questions, normalizedOptionCount, safeAnswerIndex);
    const notes = [...exactParagraphCandidate.notes];
    const reviewBlocks = Array.isArray(exactParagraphCandidate.reviewBlocks) ? exactParagraphCandidate.reviewBlocks : [];

    if (answerKey) {
      const resolved = applyAnswerKeyToQuestions(questions, answerKey);
      questions = resolved.questions;
      notes.push(...resolved.notes);
    }

    return await finalizePreferredAutoPdfResult(buildParsedQuizResult({
      parsed: exactParagraphCandidate,
      filename,
      questions,
      normalizedText,
      optionCount: normalizedOptionCount,
      answerKey,
      notes,
      reviewBlocks,
    }), fixedDocxResult, {
      buffer,
      filename,
      answerIndex,
      limit,
      answerKey,
      extension,
      optionCount: normalizedOptionCount,
    });
  }

  if (shouldPreferParagraphMarkers(extension, paragraphs, paragraphMarkersCandidate, normalizedOptionCount)) {
    let questions = normalizeParsedQuestionsForOutput(paragraphMarkersCandidate.questions, normalizedOptionCount, safeAnswerIndex);
    const notes = [...paragraphMarkersCandidate.notes];
    const reviewBlocks = Array.isArray(paragraphMarkersCandidate.reviewBlocks) ? paragraphMarkersCandidate.reviewBlocks : [];

    if (answerKey) {
      const resolved = applyAnswerKeyToQuestions(questions, answerKey);
      questions = resolved.questions;
      notes.push(...resolved.notes);
    }

    return await finalizePreferredAutoPdfResult(buildParsedQuizResult({
      parsed: paragraphMarkersCandidate,
      filename,
      questions,
      normalizedText,
      optionCount: normalizedOptionCount,
      answerKey,
      notes,
      reviewBlocks,
    }), fixedDocxResult, {
      buffer,
      filename,
      answerIndex,
      limit,
      answerKey,
      extension,
      optionCount: normalizedOptionCount,
    });
  }

  const candidates = [
    paragraphMarkersCandidate,
    exactParagraphCandidate,
    parseQuestionsFromRawExplicitNumbers(rawLines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: normalizedOptionCount }),
    parseQuestionsFromExplicitNumbers(lines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: normalizedOptionCount }),
    parseQuestionsBySequentialBlocks(lines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: normalizedOptionCount }),
    parseQuestionsByDynamicScan(lines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: normalizedOptionCount }),
    parseQuestionsByForwardScan(lines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: normalizedOptionCount }),
    parseQuestionsFromText(lines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: normalizedOptionCount }),
    parseQuestionsFromLineBlocks(lines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: normalizedOptionCount }),
    parseQuestionsFromQuestionTails(lines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: normalizedOptionCount }),
    parseQuestionsFromParagraphs(paragraphs, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: normalizedOptionCount }),
    parseQuestionsByStride(paragraphs, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: normalizedOptionCount }),
  ];

  if (extension === '.docx' && normalizedOptionCount === AUTO_OPTION_COUNT) {
    const docxFixedOptionCount = 5;
    candidates.push(
      parseQuestionsFromRawExplicitNumbers(rawLines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: docxFixedOptionCount }),
      parseQuestionsFromExplicitNumbers(lines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: docxFixedOptionCount }),
      parseQuestionsBySequentialBlocks(lines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: docxFixedOptionCount }),
      parseQuestionsByDynamicScan(lines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: docxFixedOptionCount }),
      parseQuestionsByForwardScan(lines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: docxFixedOptionCount }),
      parseQuestionsFromText(lines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: docxFixedOptionCount }),
      parseQuestionsFromLineBlocks(lines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: docxFixedOptionCount }),
      parseQuestionsFromQuestionTails(lines, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: docxFixedOptionCount }),
      parseQuestionsFromParagraphs(paragraphs, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: docxFixedOptionCount }),
      parseQuestionsByStride(paragraphs, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: docxFixedOptionCount }),
      parseQuestionsFromExactParagraphBlocks(paragraphs, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: docxFixedOptionCount }),
      parseQuestionsFromParagraphMarkers(paragraphs, { answerIndex: safeAnswerIndex, limit: effectiveLimit, optionCount: docxFixedOptionCount }),
    );
  }

  const parsed = chooseBestParsedResult(candidates, normalizedOptionCount);
  if (!parsed.questions.length) {
    throw new Error(
      normalizedOptionCount === AUTO_OPTION_COUNT
        ? 'Не удалось автоматически определить количество вариантов ответа.'
        : `Не удалось распарсить вопросы. Попробуйте другое количество вариантов ответа: сейчас выбрано ${normalizedOptionCount}.`,
    );
  }

  let questions = parsed.questions;
  const notes = [...parsed.notes];
  const reviewBlocks = Array.isArray(parsed.reviewBlocks) ? parsed.reviewBlocks : [];

  if (parsed.validation?.suspiciousQuestionCount > 0) {
    notes.push(
      `Ð›Ð¾ÐºÐ°Ð»ÑŒÐ½Ð°Ñ Ð¿Ñ€Ð¾Ð²ÐµÑ€ÐºÐ° Ð¾Ñ‚Ð¼ÐµÑ‚Ð¸Ð»Ð° Ð¿Ð¾Ð´Ð¾Ð·Ñ€Ð¸Ñ‚ÐµÐ»ÑŒÐ½Ñ‹Ñ… Ð²Ð¾Ð¿Ñ€Ð¾ÑÐ¾Ð²: ${parsed.validation.suspiciousQuestionCount}. `
      + `Ð’Ñ‹Ð±Ñ€Ð°Ð½ ÑÐ°Ð¼Ñ‹Ð¹ ÑÑ‚Ð°Ð±Ð¸Ð»ÑŒÐ½Ñ‹Ð¹ Ð²Ð°Ñ€Ð¸Ð°Ð½Ñ‚ Ð¿Ð°Ñ€ÑÐ¸Ð½Ð³Ð° Ð¸Ð· ${parsed.validation.candidateCount || candidates.length} ÐºÐ°Ð½Ð´Ð¸Ð´Ð°Ñ‚Ð¾Ð².`,
    );
  }

  const repaired = repairEmbeddedQuestionLeaks(questions, normalizedOptionCount);
  questions = repaired.questions;
  notes.push(...repaired.notes);

  const shiftedRepair = repairShiftedQuestionLines(questions, normalizedOptionCount);
  questions = shiftedRepair.questions;
  notes.push(...shiftedRepair.notes);

  const tailRepair = repairQuestionTailOptionLeaks(questions, normalizedOptionCount);
  questions = tailRepair.questions;
  notes.push(...tailRepair.notes);

  const crossQuestionRepair = repairCrossQuestionLeadingOptionLeaks(questions, normalizedOptionCount);
  questions = crossQuestionRepair.questions;
  notes.push(...crossQuestionRepair.notes);

  const reviewRecovery = repairMissingNumberedQuestionsFromReviewBlocks(
    questions,
    reviewBlocks,
    normalizedOptionCount,
    safeAnswerIndex,
  );
  questions = reviewRecovery.questions;
  notes.push(...reviewRecovery.notes);

  questions = normalizeParsedQuestionsForOutput(questions, normalizedOptionCount, safeAnswerIndex);
  const normalizedTailRepair = repairNormalizedQuestionTailOptionLeaks(questions, normalizedOptionCount);
  questions = normalizedTailRepair.questions;
  notes.push(...normalizedTailRepair.notes);

  if (answerKey) {
    const resolved = applyAnswerKeyToQuestions(questions, answerKey);
    questions = resolved.questions;
    notes.push(...resolved.notes);
  }

  return await finalizePreferredAutoPdfResult(buildParsedQuizResult({
    parsed,
    filename,
    questions,
    normalizedText,
    optionCount: normalizedOptionCount,
    answerKey,
    notes,
    reviewBlocks,
  }), fixedDocxResult, {
    buffer,
    filename,
    answerIndex,
    limit,
    answerKey,
    extension,
    optionCount: normalizedOptionCount,
  });
}

export const __test__ = {
  rebuildPdfPageTextForReadingOrder,
  repairEmbeddedQuestionLeaks,
  repairCrossQuestionLeadingOptionLeaks,
  repairMissingNumberedQuestionsFromReviewBlocks,
  normalizeParsedQuestionsForOutput,
  parseQuestionsBySequentialBlocks,
};

export function normalizeImportedQuestions(questions, {
  answerIndex = 1,
  optionCount = AUTO_OPTION_COUNT,
} = {}) {
  const normalizedOptionCount = normalizeOptionCountSetting(optionCount);
  return (Array.isArray(questions) ? questions : [])
    .map((item, index) => normalizeJsonQuestion(item, index + 1, answerIndex, normalizedOptionCount))
    .filter(Boolean);
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

function normalizeOptionCountSetting(optionCount) {
  if (String(optionCount || '').trim().toLowerCase() === AUTO_OPTION_COUNT) {
    return AUTO_OPTION_COUNT;
  }

  const numericValue = Number(optionCount);
  return Number.isInteger(numericValue) ? numericValue : 5;
}

function isAutoOptionCount(optionCount) {
  return optionCount === AUTO_OPTION_COUNT;
}

function minimumAllowedOptionCount(expectedCount) {
  if (isAutoOptionCount(expectedCount)) {
    return AUTO_OPTION_MIN;
  }

  return expectedCount === 5 ? 4 : expectedCount;
}

function maximumAllowedOptionCount(expectedCount) {
  if (isAutoOptionCount(expectedCount)) {
    return AUTO_OPTION_MAX;
  }

  const numericValue = Number(expectedCount || 0);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : AUTO_OPTION_MAX;
}

function isAcceptableOptionCount(actualCount, expectedCount) {
  if (isAutoOptionCount(expectedCount)) {
    return actualCount >= AUTO_OPTION_MIN && actualCount <= AUTO_OPTION_MAX;
  }

  return actualCount === expectedCount || (expectedCount === 5 && actualCount === 4);
}

function resolveQuestionCorrectIndex(answerIndex, optionsLength) {
  const safeOptionsLength = Math.max(1, Number(optionsLength || 0));
  const requested = Number.isInteger(Number(answerIndex)) ? Number(answerIndex) : 1;
  return Math.max(0, Math.min(safeOptionsLength - 1, requested - 1));
}

function shouldPreferExactParagraphBlocks(extension, paragraphs, candidate, optionCount) {
  const blockSize = Number(optionCount || 0) + 1;
  if (isAutoOptionCount(optionCount) || extension !== '.docx' || blockSize < 3) {
    return false;
  }

  if (!Array.isArray(paragraphs) || paragraphs.length < blockSize || paragraphs.length % blockSize !== 0) {
    return false;
  }

  const expectedQuestions = Math.floor(paragraphs.length / blockSize);
  return Array.isArray(candidate?.questions) && candidate.questions.length >= Math.max(1, expectedQuestions - 1);
}

function shouldPreferParagraphMarkers(extension, paragraphs, candidate, optionCount) {
  if (isAutoOptionCount(optionCount) || extension !== '.docx') {
    return false;
  }

  if (!Array.isArray(candidate?.questions) || candidate.questions.length < 10) {
    return false;
  }

  const markerParagraphs = Array.isArray(paragraphs)
    ? paragraphs.filter((item) => /^(\d{1,3}[.)]|[A-E][.)])/.test(sanitizeText(item))).length
    : 0;
  const blockSize = Number(optionCount || 0) + 1;
  const estimatedQuestions = blockSize >= 3 && Array.isArray(paragraphs)
    ? Math.floor(paragraphs.length / blockSize)
    : 0;

  return markerParagraphs >= candidate.questions.length * 3
    && candidate.questions.length >= Math.max(estimatedQuestions - 3, 10);
}

function buildParsedQuizResult({
  parsed,
  filename,
  questions,
  normalizedText,
  optionCount,
  answerKey,
  notes,
  reviewBlocks,
}) {
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
      validation: parsed.validation || null,
    },
    notes,
    reviewBlocks,
  };
}

async function finalizePreferredAutoPdfResult(autoResult, fixedDocxResult, context) {
  const resolvedFixed = fixedDocxResult || await loadFixedPdfAutoFallback(context);
  return choosePreferredDocxAutoResult(autoResult, resolvedFixed);
}

async function loadFixedPdfAutoFallback({
  buffer,
  filename,
  answerIndex,
  limit,
  answerKey,
  extension,
  optionCount,
}) {
  if (!isAutoOptionCount(optionCount) || (extension !== '.docx' && extension !== '.pdf')) {
    return null;
  }

  try {
    return await parseQuizFromFile({
      buffer,
      filename,
      answerIndex,
      limit,
      optionCount: 5,
      answerKey,
      preferDocxFixedAuto: false,
    });
  } catch {
    return null;
  }
}

function choosePreferredDocxAutoResult(autoResult, fixedDocxResult) {
  if (!fixedDocxResult) {
    return autoResult;
  }

  const autoQuestionCount = autoResult.questions?.length || 0;
  const fixedQuestionCount = fixedDocxResult.questions?.length || 0;
  const autoSuspiciousFragments = countSuspiciousLowercaseOptionFragments(autoResult.questions);
  const fixedSuspiciousFragments = countSuspiciousLowercaseOptionFragments(fixedDocxResult.questions);

  if (fixedQuestionCount <= autoQuestionCount && fixedSuspiciousFragments > autoSuspiciousFragments) {
    return autoResult;
  }

  if (fixedQuestionCount > autoQuestionCount) {
    return fixedDocxResult;
  }

  const autoOptions = summarizeParsedOptionCounts(autoResult.questions);
  const fixedOptions = summarizeParsedOptionCounts(fixedDocxResult.questions);

  if (
    fixedQuestionCount >= autoQuestionCount
    && autoOptions.min < 4
    && fixedOptions.min >= 4
  ) {
    return fixedDocxResult;
  }

  if (
    fixedQuestionCount === autoQuestionCount
    && fixedOptions.min > autoOptions.min
    && fixedOptions.average >= autoOptions.average + 1
  ) {
    return fixedDocxResult;
  }

  return autoResult;
}

function countSuspiciousLowercaseOptionFragments(questions) {
  return Array.isArray(questions)
    ? questions.reduce((total, question) => total + countQuestionSuspiciousLowercaseOptionFragments(question), 0)
    : 0;
}

function countQuestionSuspiciousLowercaseOptionFragments(question) {
  const options = Array.isArray(question?.options)
    ? question.options.map((option) => sanitizeText(option)).filter(Boolean)
    : [];

  let count = 0;
  for (let index = 1; index < options.length; index += 1) {
    const current = options[index];
    const previous = options[index - 1];
    const words = current.split(/\s+/).filter(Boolean).length;

    if (
      /^[\p{Ll}\p{Lo}]/u.test(current)
      && words <= 3
      && current.length <= 36
      && !/[.?!:;]$/.test(previous)
    ) {
      count += 1;
    }
  }

  return count;
}

function summarizeParsedOptionCounts(questions) {
  const counts = Array.isArray(questions)
    ? questions
      .map((question) => Array.isArray(question?.options) ? question.options.length : 0)
      .filter((count) => Number.isInteger(count) && count > 0)
    : [];

  if (!counts.length) {
    return {
      min: 0,
      average: 0,
    };
  }

  return {
    min: Math.min(...counts),
    average: counts.reduce((sum, count) => sum + count, 0) / counts.length,
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
      return buildPdfTextFromPages(result.pages, result.text || '');
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

function buildPdfTextFromPages(pages, fallbackText = '') {
  if (!Array.isArray(pages) || !pages.length) {
    return String(fallbackText || '');
  }

  const normalizedPages = pages
    .map((page) => stripLeadingPdfPageNumber(rebuildPdfPageTextForReadingOrder(page?.text || '')))
    .filter(Boolean);

  return normalizedPages.length ? normalizedPages.join('\n') : String(fallbackText || '');
}

function stripLeadingPdfPageNumber(pageText) {
  const lines = String(pageText || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => cleanupLine(line));

  while (lines.length && /^\d{1,3}$/.test(lines[0])) {
    lines.shift();
  }

  return lines.filter(Boolean).join('\n').trim();
}

function rebuildPdfPageTextForReadingOrder(pageText) {
  const normalized = String(pageText || '')
    .replace(/\r/g, '\n')
    .trim();

  if (!normalized) {
    return '';
  }

  const lines = normalized
    .split('\n')
    .map((line) => cleanupLine(line))
    .filter(Boolean);

  if (lines.length < 8) {
    return normalized;
  }

  const blockStarts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const questionMatch = matchQuestionStart(lines[index]);
    const questionNumber = extractLeadingQuestionNumber(lines[index]);
    if (
      questionMatch
      && Number.isInteger(questionNumber)
      && !looksLikeHyphenatedReorderArtifact(lines, index)
    ) {
      blockStarts.push({ index, number: questionNumber });
    }
  }

  if (blockStarts.length < 4) {
    return normalized;
  }

  let outOfOrderPairs = 0;
  for (let index = 1; index < blockStarts.length; index += 1) {
    if (blockStarts[index].number <= blockStarts[index - 1].number) {
      outOfOrderPairs += 1;
    }
  }

  if (!outOfOrderPairs) {
    return normalized;
  }

  const uniqueNumbers = new Set(blockStarts.map((block) => block.number));
  if (uniqueNumbers.size !== blockStarts.length) {
    return normalized;
  }

  const prefix = lines.slice(0, blockStarts[0].index);
  const blocks = blockStarts.map((block, index) => ({
    number: block.number,
    lines: lines.slice(block.index, blockStarts[index + 1]?.index ?? lines.length),
  }));

  const sortedBlocks = [...blocks].sort((left, right) => left.number - right.number);
  return [
    ...prefix,
    ...sortedBlocks.flatMap((block) => block.lines),
  ].join('\n');
}

function looksLikeHyphenatedReorderArtifact(lines, index) {
  const inlineMatch = matchStrictInlineQuestionStart(lines[index] || '');
  if (!inlineMatch) {
    return false;
  }

  const previousLine = findPreviousMeaningfulRawLine(lines, index - 1);
  const nextLine = findNextMeaningfulRawLine(lines, index + 1);
  return looksLikeHyphenatedQuestionContinuation({ lines: [previousLine] }, inlineMatch, nextLine);
}

function normalizeParsedQuestionsForOutput(questions, optionCount, answerIndex) {
  const expectedOptionCount = Number(optionCount);
  const autoMode = isAutoOptionCount(optionCount);

  return (Array.isArray(questions) ? questions : [])
    .map((question) => {
      const normalizedQuestionText = normalizeQuestionPromptForOutput(question?.q);
      let normalizedOptions = Array.isArray(question?.options)
        ? question.options.map((option) => sanitizeText(option)).filter(Boolean)
        : [];

      if (autoMode) {
        normalizedOptions = normalizeAutoOptionsForOutput(normalizedOptions);
        if (!normalizedQuestionText || !isAcceptableOptionCount(normalizedOptions.length, AUTO_OPTION_COUNT)) {
          return null;
        }

        return {
          ...question,
          q: normalizedQuestionText,
          options: normalizedOptions,
          correctIndex: resolveQuestionCorrectIndex(answerIndex, normalizedOptions.length),
        };
      }

      if (!Number.isInteger(expectedOptionCount) || expectedOptionCount < 2) {
        return null;
      }

      normalizedOptions = normalizedOptions.slice(0, expectedOptionCount);
      while (normalizedOptions.length < expectedOptionCount) {
        normalizedOptions.push('');
      }

      return {
        ...question,
        q: normalizedQuestionText,
        options: normalizedOptions,
        correctIndex: resolveQuestionCorrectIndex(answerIndex, expectedOptionCount),
      };
    })
    .filter(Boolean);
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

function normalizeQuestionPromptForOutput(questionText) {
  return stripLeadingTopicPreamble(sanitizeText(questionText));
}

function normalizeAutoOptionsForOutput(optionsInput) {
  let options = Array.isArray(optionsInput) ? optionsInput.map((option) => sanitizeText(option)).filter(Boolean) : [];

  while (options.length > 5) {
    const mergeIndex = findAutoOverflowMergeIndex(options);
    if (mergeIndex <= 0 || mergeIndex >= options.length) {
      break;
    }

    options[mergeIndex - 1] = joinFragments(options[mergeIndex - 1], options[mergeIndex]);
    options.splice(mergeIndex, 1);
  }

  return options;
}

function findAutoOverflowMergeIndex(options) {
  if (!Array.isArray(options) || options.length <= 5) {
    return -1;
  }

  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let index = 1; index < options.length; index += 1) {
    const previous = sanitizeText(options[index - 1]);
    const current = sanitizeText(options[index]);
    if (!previous || !current) {
      continue;
    }

    const currentWordCount = current.split(/\s+/).filter(Boolean).length;
    let score = Number.NEGATIVE_INFINITY;
    if (looksLikeOverflowOptionContinuation(previous, current)) {
      score = 80;
    } else if (
      /^[\p{Ll}\p{Lo}]/u.test(current)
      && currentWordCount <= 3
      && current.length <= 32
    ) {
      score = 70;
    } else if (
      shouldContinueOptionText(previous, current)
      && currentWordCount <= 3
      && current.length <= 32
    ) {
      score = 65;
    } else if (currentWordCount <= 2 && current.length <= 28) {
      score = 35;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestScore > 0 ? bestIndex : -1;
}

function stripLeadingTopicPreamble(questionText) {
  const text = sanitizeText(questionText);
  if (!text) {
    return '';
  }

  const numberMatch = text.match(/^(\d+\.\s*)(.+)$/u);
  const prefix = numberMatch ? numberMatch[1] : '';
  const body = numberMatch ? numberMatch[2] : text;
  const fragments = body.split(/(?<=[.?!:])\s+/u).map((fragment) => sanitizeText(fragment)).filter(Boolean);

  if (fragments.length < 2) {
    return text;
  }

  const cutIndex = fragments.findIndex((fragment, index) => {
    if (index === 0) {
      return false;
    }
    return looksLikeClinicalQuestionSentenceStart(fragment);
  });

  if (cutIndex <= 0) {
    return text;
  }

  const headingLikePrefix = fragments.slice(0, cutIndex);
  if (!headingLikePrefix.every(looksLikeTopicPreambleFragment)) {
    return stripLeadingTopicPreambleBySentenceBoundary(text, prefix, body);
  }

  return sanitizeText(prefix + fragments.slice(cutIndex).join(' '));
}

function stripLeadingTopicPreambleBySentenceBoundary(fullText, prefix, body) {
  const boundaryMatch = body.match(/(?:^|[.?!:]\s+)(У|В|До|При|Під|Після|На|Хвор(?:ий|а|ому|ого)|Пацієнт|У посіві|У хворого|У жінки|У чоловіка|У дитини|До лікарні|Під час|В експерименті)\b/u);
  if (!boundaryMatch || boundaryMatch.index == null || boundaryMatch.index <= 0) {
    return fullText;
  }

  const prefixText = sanitizeText(body.slice(0, boundaryMatch.index));
  const prefixSentenceCount = (prefixText.match(/[.?!:]/g) || []).length;
  if (prefixSentenceCount < 2) {
    return fullText;
  }

  const suffixText = sanitizeText(body.slice(boundaryMatch.index));
  if (!suffixText) {
    return fullText;
  }

  return sanitizeText(prefix + suffixText);
}

function looksLikeClinicalQuestionSentenceStart(fragment) {
  const text = sanitizeText(fragment);
  if (!text) {
    return false;
  }

  return /^(У|В|До|При|Під|Після|На|Хвор(ий|а|ому|ого)|Пацієнт|У посіві|У хворого|У жінки|У чоловіка|У дитини|До лікарні|Під час|В експерименті)(\s|$)/u.test(text);
}

function looksLikeTopicPreambleFragment(fragment) {
  const text = sanitizeText(fragment);
  if (!text) {
    return false;
  }

  if (looksLikeClinicalQuestionSentenceStart(text)) {
    return false;
  }

  if (/[?:]$/.test(text)) {
    return false;
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 12) {
    return true;
  }

  return /^Змістовий модуль\b/iu.test(text);
}

function splitIntoLines(text) {
  return String(text || '')
    .split('\n')
    .flatMap((line) => splitEmbeddedQuestionStarts(line))
    .map((line) => cleanupLine(line))
    .filter((line) => !shouldIgnoreLine(line));
}

function splitIntoParagraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((part) => cleanupLine(part))
    .filter((part) => !shouldIgnoreLine(part));
}

function splitEmbeddedQuestionStarts(line) {
  const input = String(line || '');
  if (!input) {
    return [''];
  }

  const parts = [];
  let cursor = 0;
  const regex = /(?<=[^\s\d])(\d{1,3}[.)]\s+)/gu;
  let match;

  while ((match = regex.exec(input))) {
    const start = match.index;
    const prefix = input.slice(cursor, start);
    if (prefix) {
      parts.push(prefix);
    }
    cursor = start;
  }

  const tail = input.slice(cursor);
  if (tail) {
    parts.push(tail);
  }

  return parts.length ? parts : [input];
}

function parseQuestionsFromText(linesInput, { answerIndex, limit, optionCount }) {
  const lines = Array.isArray(linesInput) ? linesInput : splitIntoLines(linesInput);
  const questions = [];
  const notes = [];
  const reviewBlocks = [];
  const maxOptionCount = maximumAllowedOptionCount(optionCount);
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

    if (questionMatch && isAcceptableOptionCount(current.options.length, optionCount)) {
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
      if (current.options.length < maxOptionCount) {
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
      correctIndex: resolveQuestionCorrectIndex(answerIndex, parsedBlock.options.length),
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

function parseQuestionsFromRawExplicitNumbers(linesInput, { answerIndex, limit, optionCount }) {
  const lines = Array.isArray(linesInput) ? linesInput : String(linesInput || '').split('\n').map((line) => cleanupLine(line));
  const blocks = [];
  let current = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const embeddedStart = current ? splitEmbeddedRawQuestionStart(line, current.number) : null;
    if (embeddedStart) {
      if (embeddedStart.prefix) {
        current.lines.push(embeddedStart.prefix);
      }

      if (embeddedStart.text) {
        current.lines.push(embeddedStart.text);
        current.embeddedSuccessor = {
          number: embeddedStart.number,
          text: embeddedStart.text,
        };
      }
      continue;
    }

    const inlineMatch = matchStrictInlineQuestionStart(line);
    const standaloneMatch = inlineMatch ? null : matchStandaloneQuestionStart(line);
    const nextLine = findNextMeaningfulRawLine(lines, index + 1);

    if (inlineMatch && looksLikeNumericOptionInlineStart(inlineMatch)) {
      if (current) {
        current.lines.push(line);
      }
      continue;
    }

    if (inlineMatch && looksLikeHyphenatedQuestionContinuation(current, inlineMatch, nextLine)) {
      current.lines[current.lines.length - 1] = joinFragments(current.lines.at(-1), `${inlineMatch.number}. ${inlineMatch.text}`);
      continue;
    }

    if (standaloneMatch && looksLikeRawNumericOptionLine(line, current, nextLine)) {
      if (current) {
        current.lines.push(line);
      }
      continue;
    }

    if (standaloneMatch || inlineMatch) {
      if (current) {
        blocks.push(current);
      }

      current = {
        number: (standaloneMatch || inlineMatch).number,
        lines: [],
      };

      const rest = sanitizeText(inlineMatch ? inlineMatch.text : '');
      const embeddedStartInRest = rest ? splitEmbeddedRawQuestionStart(rest, current.number) : null;
      if (embeddedStartInRest) {
        if (embeddedStartInRest.prefix) {
          current.lines.push(embeddedStartInRest.prefix);
        }

        if (embeddedStartInRest.text) {
          current.lines.push(embeddedStartInRest.text);
          current.embeddedSuccessor = {
            number: embeddedStartInRest.number,
            text: embeddedStartInRest.text,
          };
        }
      } else if (rest) {
        current.lines.push(rest);
      }
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
      reviewBlocks.push(createReviewBlock(block.lines, 'raw-explicit-number-block'));
      continue;
    }

    questions.push({
      q: `${block.number}. ${parsedBlock.q}`,
      options: parsedBlock.options,
      correctIndex: resolveQuestionCorrectIndex(answerIndex, parsedBlock.options.length),
    });

    const embeddedSuccessorQuestion = buildEmbeddedSuccessorQuestion(block, parsedBlock, optionCount, answerIndex);
    if (embeddedSuccessorQuestion) {
      questions.push(embeddedSuccessorQuestion);
    }

    if (questions.length >= limit) {
      break;
    }
  }

  const notes = [];
  if (droppedBlocks > 0) {
    notes.push(`Skipped malformed numbered blocks: ${droppedBlocks}.`);
  }
  notes.push(...buildLimitNote(questions.length, limit));

  return {
    parser: 'raw-explicit-numbers',
    questions,
    notes,
    reviewBlocks,
    droppedBlocks,
    qualityScore: questions.length * 30 - droppedBlocks,
  };
}

function splitEmbeddedRawQuestionStart(line, currentNumber) {
  const text = sanitizeText(line);
  const current = Number(currentNumber);
  if (!text || !Number.isInteger(current)) {
    return null;
  }

  const pattern = /^(.*?\S)\s+(\d{1,3})[.)]\s+(.+)$/u;
  const match = text.match(pattern);
  if (!match) {
    return null;
  }

  const nextNumber = Number(match[2]);
  const prefix = sanitizeText(match[1]);
  const nextText = sanitizeText(match[3]);
  if (
    !Number.isInteger(nextNumber)
    || nextNumber !== current + 1
    || !prefix
    || !nextText
    || (!looksLikePromptSentence(nextText) && !looksLikeQuestionTail(nextText) && !/[?]$/.test(nextText))
    || /[-–—]$/.test(prefix)
  ) {
    return null;
  }

  return {
    prefix,
    number: nextNumber,
    text: nextText,
  };
}

function looksLikeHyphenatedQuestionContinuation(current, inlineMatch, nextLine = '') {
  const lastLine = sanitizeText(current?.lines?.at(-1));
  const text = sanitizeText(inlineMatch?.text);
  const following = sanitizeText(nextLine);
  const number = Number(inlineMatch?.number);
  if (!lastLine || !text || !Number.isInteger(number)) {
    return false;
  }

  const combined = sanitizeText([text, following].filter(Boolean).join(' '));

  return /[-–—]$/.test(lastLine)
    && number >= 1
    && number <= 9
    && (
      looksLikePromptSentence(text)
      || looksLikeQuestionTail(text)
      || /[?]$/.test(text)
      || (combined && (looksLikePromptSentence(combined) || looksLikeQuestionTail(combined) || /[?]$/.test(combined)))
    );
}

function buildEmbeddedSuccessorQuestion(block, parsedBlock, optionCount, answerIndex) {
  if (!block?.embeddedSuccessor?.text || !Number.isInteger(Number(block.embeddedSuccessor.number))) {
    return null;
  }

  const cleanLines = normalizeBlockLines(block.lines);
  const splitIndex = findExplicitQuestionOptionBoundary(cleanLines, optionCount);
  if (splitIndex < 0) {
    return null;
  }

  const questionLines = cleanLines.slice(0, splitIndex + 1);
  const startIndex = questionLines.findIndex((line) => sanitizeText(line) === sanitizeText(block.embeddedSuccessor.text));
  if (startIndex < 0) {
    return null;
  }

  const questionText = sanitizeText(questionLines.slice(startIndex).join(' '));
  if (!questionText) {
    return null;
  }

  return {
    q: `${block.embeddedSuccessor.number}. ${questionText}`,
    options: [...parsedBlock.options],
    correctIndex: resolveQuestionCorrectIndex(answerIndex, parsedBlock.options.length),
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
      correctIndex: resolveQuestionCorrectIndex(answerIndex, matchedQuestion.options.length),
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

function parseQuestionsBySequentialBlocks(linesInput, { answerIndex, limit, optionCount }) {
  const lines = Array.isArray(linesInput) ? linesInput : splitIntoLines(linesInput);
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : Number.MAX_SAFE_INTEGER;
  const questions = [];
  const reviewBlocks = [];
  let droppedBlocks = 0;

  for (let index = 0; index < lines.length && questions.length < safeLimit; index += 1) {
    const line = sanitizeText(lines[index]);
    if (!line || shouldIgnoreLine(line) || isLikelyStandaloneMetaHeading(line)) {
      continue;
    }

    let matchedCandidate = null;

    for (let offset = 0; offset <= 18; offset += 1) {
      const endIndex = index + offset;
      if (endIndex >= lines.length) {
        break;
      }

      const chunk = lines.slice(index, endIndex + 1).filter(Boolean);
      if (!chunk.length) {
        continue;
      }

      const tailLine = sanitizeText(chunk.at(-1));
      const questionText = backfillQuestionLeadIn(lines, index, buildQuestionText(chunk));
      const questionLooksClosed = looksLikeQuestionTail(tailLine)
        || (/[.?:]$/.test(tailLine) && looksLikePromptSentence(questionText));
      if (!questionText || !questionLooksClosed) {
        continue;
      }

      const optionBlock = collectSequentialOptions(lines, endIndex + 1, optionCount);
      if (!optionBlock || !looksLikeRealQuestion(questionText, optionBlock.options)) {
        continue;
      }

      matchedCandidate = {
        questionText,
        options: optionBlock.options,
        nextIndex: optionBlock.nextIndex,
      };
      break;
    }

    if (!matchedCandidate) {
      continue;
    }

    questions.push({
      q: matchedCandidate.questionText,
      options: matchedCandidate.options,
      correctIndex: resolveQuestionCorrectIndex(answerIndex, matchedCandidate.options.length),
    });

    index = matchedCandidate.nextIndex - 1;
  }

  if (!questions.length) {
    droppedBlocks += 1;
  }

  const notes = [];
  if (droppedBlocks > 0 && questions.length === 0) {
    notes.push(`Skipped malformed sequential blocks: ${droppedBlocks}.`);
  }
  notes.push(...buildLimitNote(questions.length, safeLimit));

  return {
    parser: 'sequential-blocks',
    questions,
    notes,
    reviewBlocks,
    droppedBlocks,
    qualityScore: questions.length * 22 - droppedBlocks,
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
      correctIndex: resolveQuestionCorrectIndex(answerIndex, current.pick.options.length),
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
      correctIndex: resolveQuestionCorrectIndex(answerIndex, parsedBlock.options.length),
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

    if (isAutoOptionCount(optionCount)) {
      const rawOptions = [];

      for (let optionIndex = index + 1; optionIndex < paragraphs.length; optionIndex += 1) {
        const candidate = sanitizeText(paragraphs[optionIndex]);
        if (!candidate) {
          continue;
        }

        if (looksLikeQuestionParagraph(candidate)) {
          break;
        }

        rawOptions.push(candidate);
        if (rawOptions.length >= AUTO_OPTION_MAX + 2) {
          break;
        }
      }

      const cleanOptions = normalizeAutoOptionLines(rawOptions);
      if (!isAcceptableOptionCount(cleanOptions.length, AUTO_OPTION_COUNT)) {
        droppedBlocks += 1;
        reviewBlocks.push(createReviewBlock([current, ...rawOptions], 'paragraph-auto-structure'));
        continue;
      }

      questions.push({
        q: sanitizeText(current),
        options: cleanOptions,
        correctIndex: resolveQuestionCorrectIndex(answerIndex, cleanOptions.length),
      });

      if (questions.length >= limit) {
        break;
      }

      index += rawOptions.length;
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
      correctIndex: resolveQuestionCorrectIndex(answerIndex, cleanOptions.length),
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

function parseQuestionsFromExactParagraphBlocks(textInput, { answerIndex, limit, optionCount }) {
  if (isAutoOptionCount(optionCount)) {
    return emptyParsedResult('exact-paragraph-blocks', limit);
  }

  const paragraphs = Array.isArray(textInput) ? textInput : splitIntoParagraphs(textInput);
  const blockSize = optionCount + 1;

  if (paragraphs.length < blockSize) {
    return emptyParsedResult('exact-paragraph-blocks', limit);
  }

  let best = {
    questions: [],
    score: Number.NEGATIVE_INFINITY,
    offset: 0,
    suspiciousBlocks: 0,
  };

  for (let offset = 0; offset < Math.min(blockSize, paragraphs.length); offset += 1) {
    const questions = [];
    let score = 0;
    let suspiciousBlocks = 0;

    for (let index = offset; index + blockSize - 1 < paragraphs.length; index += blockSize) {
      const chunk = paragraphs.slice(index, index + blockSize).map((item) => sanitizeText(item)).filter(Boolean);
      if (chunk.length !== blockSize) {
        suspiciousBlocks += 1;
        continue;
      }

      const question = chunk[0];
      const options = chunk.slice(1);
      if (!question || options.length !== optionCount) {
        suspiciousBlocks += 1;
        continue;
      }

      const chunkScore = scoreExactParagraphChunk(question, options, optionCount);

      questions.push({
        q: question,
        options,
        correctIndex: resolveQuestionCorrectIndex(answerIndex, options.length),
      });
      score += chunkScore;

      if (questions.length >= limit) {
        break;
      }
    }

    const totalScore = questions.length * 100 + score - suspiciousBlocks * 25;
    if (
      questions.length > best.questions.length
      || (questions.length === best.questions.length && totalScore > best.score)
    ) {
      best = { questions, score: totalScore, offset, suspiciousBlocks };
    }
  }

  const notes = [];
  if (best.offset > 0) {
    notes.push(`ÐŸÑ€Ð¾Ð¿ÑƒÑ‰ÐµÐ½Ð¾ ÑÐ»ÑƒÐ¶ÐµÐ±Ð½Ñ‹Ñ… Ð°Ð±Ð·Ð°Ñ†ÐµÐ² Ð² Ð½Ð°Ñ‡Ð°Ð»Ðµ: ${best.offset}.`);
  }
  if (best.suspiciousBlocks > 0) {
    notes.push(`ÐŸÑ€Ð¾Ð¿ÑƒÑ‰ÐµÐ½Ð¾ Ð±Ð»Ð¾ÐºÐ¾Ð² Ñ Ð½ÐµÑÑÐ½Ð¾Ð¹ ÑÑ‚Ñ€ÑƒÐºÑ‚ÑƒÑ€Ð¾Ð¹: ${best.suspiciousBlocks}.`);
  }
  notes.push(...buildLimitNote(best.questions.length, limit));

  return {
    parser: 'exact-paragraph-blocks',
    questions: best.questions,
    notes,
    droppedBlocks: best.suspiciousBlocks,
    qualityScore: best.score,
  };
}

function parseQuestionsFromParagraphMarkers(textInput, { answerIndex, limit, optionCount }) {
  const paragraphs = Array.isArray(textInput) ? textInput : splitIntoParagraphs(textInput);
  const entries = paragraphs
    .flatMap((paragraph) => splitEmbeddedQuestionStarts(cleanupLine(paragraph)))
    .map((item) => cleanupLine(item))
    .filter(Boolean)
    .filter((item) => !shouldIgnoreLine(item));

  const questions = [];
  const reviewBlocks = [];
  const maxOptionCount = maximumAllowedOptionCount(optionCount);
  let droppedBlocks = 0;
  let current = null;

  for (const entry of entries) {
    const questionMatch = matchQuestionStart(entry) || matchStandaloneQuestionStart(entry);
    const optionMatch = matchOptionStart(entry, optionCount);

    if (questionMatch) {
      if (current) {
        if (pushCompletedQuestion(questions, current, answerIndex, optionCount)) {
          if (questions.length >= limit) {
            break;
          }
        } else {
          droppedBlocks += 1;
          reviewBlocks.push(createReviewBlock([current.q, ...current.options], 'paragraph-markers-incomplete'));
        }
      }

      current = createQuestionState(questionMatch.text || '');
      continue;
    }

    if (!current) {
      continue;
    }

    if (optionMatch) {
      const embeddedQuestion = extractTrailingQuestionStart(optionMatch.text);
      if (embeddedQuestion) {
        current.options.push(embeddedQuestion.leadingText);
        if (pushCompletedQuestion(questions, current, answerIndex, optionCount)) {
          if (questions.length >= limit) {
            break;
          }
        } else {
          droppedBlocks += 1;
          reviewBlocks.push(createReviewBlock([current.q, ...current.options], 'paragraph-markers-trailing-question'));
        }

        current = createQuestionState(embeddedQuestion.questionText);
        continue;
      }

      if (current.options.length < maxOptionCount) {
        current.options.push(optionMatch.text);
        continue;
      }
    }

    if (!current.options.length) {
      current.q = joinFragments(current.q, entry);
    } else {
      const lastIndex = current.options.length - 1;
      current.options[lastIndex] = joinFragments(current.options[lastIndex], entry);
    }
  }

  if (current && questions.length < limit) {
    if (!pushCompletedQuestion(questions, current, answerIndex, optionCount)) {
      droppedBlocks += 1;
      reviewBlocks.push(createReviewBlock([current.q, ...current.options], 'paragraph-markers-tail'));
    }
  }

  const notes = [];
  if (droppedBlocks > 0) {
    notes.push(`ÐŸÑ€Ð¾Ð¿ÑƒÑ‰ÐµÐ½Ð¾ Ð±Ð»Ð¾ÐºÐ¾Ð² Ð¸Ð·-Ð·Ð° Ð½ÐµÐ¿Ð¾Ð»Ð½Ð¾Ð¹ ÑÑ‚Ñ€ÑƒÐºÑ‚ÑƒÑ€Ñ‹: ${droppedBlocks}.`);
  }
  notes.push(...buildLimitNote(questions.length, limit));

  return {
    parser: 'paragraph-markers',
    questions: questions.slice(0, limit),
    notes,
    reviewBlocks,
    droppedBlocks,
    qualityScore: questions.length * 26 - droppedBlocks,
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
          correctIndex: resolveQuestionCorrectIndex(answerIndex, wrappedQuestion.options.length),
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
      correctIndex: resolveQuestionCorrectIndex(answerIndex, optionBlock.options.length),
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
  if (isAutoOptionCount(optionCount)) {
    return emptyParsedResult('stride', limit);
  }

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
        correctIndex: resolveQuestionCorrectIndex(answerIndex, options.length),
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

function scoreExactParagraphChunk(question, options, optionCount) {
  if (!question || !Array.isArray(options) || options.length !== optionCount) {
    return 0;
  }

  let score = 0;
  if (question.length >= 30) {
    score += 10;
  }

  if (looksLikeQuestionTail(question) || looksLikePromptSentence(question)) {
    score += 8;
  }

  if (looksLikeRealQuestion(question, options)) {
    score += 10;
  }

  if (options.every((option) => looksLikeStandaloneOptionLine(option))) {
    score += 8;
  }

  if (options.some((option) => looksLikeQuestionTail(option) && looksLikePromptSentence(option))) {
    score -= 20;
  }

  const averageOptionLength = options.reduce((sum, option) => sum + option.length, 0) / Math.max(1, options.length);
  if (question.length > averageOptionLength) {
    score += 6;
  }

  return score;
}

function chooseBestParsedResult(candidates, optionCount) {
  const evaluated = candidates.map((candidate) => evaluateParsedCandidate(candidate, optionCount));
  for (const candidate of evaluated) {
    candidate.validation.candidateCount = evaluated.length;
  }

  return evaluated.reduce((best, current) => {
    if (!best) {
      return current;
    }

    if ((current.validation?.adjustedQuestionCount || 0) > (best.validation?.adjustedQuestionCount || 0)) {
      return current;
    }

    if (
      (current.validation?.adjustedQuestionCount || 0) === (best.validation?.adjustedQuestionCount || 0)
      && (current.validation?.selectionScore || 0) > (best.validation?.selectionScore || 0)
    ) {
      return current;
    }

    if (
      (current.validation?.adjustedQuestionCount || 0) === (best.validation?.adjustedQuestionCount || 0)
      && (current.validation?.selectionScore || 0) === (best.validation?.selectionScore || 0)
      && current.questions.length > best.questions.length
    ) {
      return current;
    }

    return best;
  }, null);
}

function evaluateParsedCandidate(candidate, optionCount) {
  const validation = assessParsedQuestions(candidate?.questions, optionCount);
  const adjustedQuestionCount = Math.max(
    0,
    (candidate?.questions?.length || 0) - validation.suspiciousQuestionCount * 2 - validation.duplicateQuestionCount,
  );
  const selectionScore = adjustedQuestionCount * 100000
    + validation.numberingQuestionCount * 2000
    + (candidate?.qualityScore || 0)
    + validation.scoreAdjustment;

  return {
    ...candidate,
    validation: {
      ...validation,
      adjustedQuestionCount,
      selectionScore,
    },
  };
}

function assessParsedQuestions(questions, optionCount) {
  const minOptionCount = minimumAllowedOptionCount(optionCount);
  const seenQuestions = new Set();
  const extractedNumbers = [];
  let suspiciousQuestionCount = 0;
  let duplicateQuestionCount = 0;
  let scoreAdjustment = 0;

  for (const question of Array.isArray(questions) ? questions : []) {
    const prompt = sanitizeText(question?.q);
    const options = Array.isArray(question?.options)
      ? question.options.map((option) => sanitizeText(option)).filter(Boolean)
      : [];
    let questionIsSuspicious = false;

    if (!prompt) {
      questionIsSuspicious = true;
      scoreAdjustment -= 80;
      suspiciousQuestionCount += 1;
      continue;
    }

    const normalizedPrompt = prompt.toLocaleLowerCase('uk-UA');
    if (seenQuestions.has(normalizedPrompt)) {
      duplicateQuestionCount += 1;
      scoreAdjustment -= 40;
    } else {
      seenQuestions.add(normalizedPrompt);
    }

    const explicitNumber = extractLeadingQuestionNumber(prompt);
    if (explicitNumber != null) {
      extractedNumbers.push(explicitNumber);
    }

    const contamination = detectLeadingOptionLeak(prompt, optionCount);
    if (contamination) {
      questionIsSuspicious = true;
      scoreAdjustment -= 140 - contamination.leakedOptionCount * 10;
    }

    if (!looksLikeRealQuestion(prompt, options)) {
      questionIsSuspicious = true;
      scoreAdjustment -= 40;
    }

    if (!isAcceptableOptionCount(options.length, optionCount)) {
      questionIsSuspicious = true;
      scoreAdjustment -= 80;
    }

    const questionLikeOptions = options.filter((option) => looksLikeQuestionTail(option) && looksLikePromptSentence(option));
    if (questionLikeOptions.length) {
      questionIsSuspicious = true;
      scoreAdjustment -= 50 * questionLikeOptions.length;
    }

    if (options.length >= minOptionCount && options.every((option) => option.length <= 3)) {
      scoreAdjustment -= 35;
    }

    if (questionIsSuspicious) {
      suspiciousQuestionCount += 1;
    }
  }

  const numberingQuestionCount = countLeadingSequentialNumbers(extractedNumbers);
  if (numberingQuestionCount >= Math.max(5, Math.floor((Array.isArray(questions) ? questions.length : 0) * 0.7))) {
    scoreAdjustment += numberingQuestionCount * 6;
  }

  return {
    suspiciousQuestionCount,
    duplicateQuestionCount,
    numberingQuestionCount,
    scoreAdjustment,
  };
}

function extractLeadingQuestionNumber(questionText) {
  const match = sanitizeText(questionText).match(/^(\d{1,3})[.)]?\s+/);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  return Number.isInteger(value) && value >= 1 && value <= 999 ? value : null;
}

function countLeadingSequentialNumbers(numbers) {
  if (!Array.isArray(numbers) || !numbers.length) {
    return 0;
  }

  let expected = 1;
  let count = 0;

  for (const value of numbers) {
    if (value !== expected) {
      break;
    }
    count += 1;
    expected += 1;
  }

  return count;
}

function extractTrailingQuestionStart(text) {
  const value = sanitizeText(text);
  const match = value.match(/^(.*?)(\d{1,3}[.)]\s+.+)$/u);
  if (!match) {
    return null;
  }

  const leadingText = sanitizeText(match[1]);
  const questionText = sanitizeText(match[2]);
  if (!leadingText || !questionText) {
    return null;
  }

  if (!matchQuestionStart(questionText)) {
    return null;
  }

  return {
    leadingText,
    questionText: matchQuestionStart(questionText)?.text ? questionText.replace(/^\d{1,3}\s*[.)\-–—:]\s*/u, '') : questionText,
  };
}

function repairEmbeddedQuestionLeaks(questions, optionCount) {
  const repairedQuestions = [];
  let repairedCount = 0;

  for (const question of Array.isArray(questions) ? questions : []) {
    const embedded = extractEmbeddedQuestion(question?.q, optionCount);
    if (embedded) {
      repairedQuestions.push({
        ...question,
        q: stripEmbeddedPromptNumberMarkers(embedded.questionText),
        options: embedded.options,
        correctIndex: Math.max(0, Math.min(embedded.options.length - 1, Number(question?.correctIndex) || 0)),
      });
      repairedCount += 1;
      continue;
    }

    const leakedPromptOptions = extractQuestionOptionsLeakedIntoPrompt(question, optionCount);
    if (leakedPromptOptions) {
      repairedQuestions.push({
        ...question,
        q: stripEmbeddedPromptNumberMarkers(leakedPromptOptions.questionText),
        options: leakedPromptOptions.options,
        correctIndex: Math.max(0, Math.min(leakedPromptOptions.options.length - 1, Number(question?.correctIndex) || 0)),
      });
      repairedCount += 1;
      continue;
    }

    const trailingOptions = extractTrailingOptionsFromQuestion(question, optionCount);
    if (trailingOptions) {
      repairedQuestions.push({
        ...question,
        q: stripEmbeddedPromptNumberMarkers(trailingOptions.questionText),
        options: trailingOptions.options,
        correctIndex: Math.max(0, Math.min(trailingOptions.options.length - 1, Number(question?.correctIndex) || 0)),
      });
      repairedCount += 1;
      continue;
    }

    const inlineLeak = extractQuestionContinuationFromOptions(question, optionCount);
    if (inlineLeak) {
      repairedQuestions.push({
        ...question,
        q: stripEmbeddedPromptNumberMarkers(inlineLeak.questionText),
        options: inlineLeak.options,
        correctIndex: Math.max(0, Math.min(inlineLeak.options.length - 1, Number(question?.correctIndex) || 0)),
      });
      repairedCount += 1;
      continue;
    }

    repairedQuestions.push({
      ...question,
      q: stripEmbeddedPromptNumberMarkers(question?.q),
    });
  }

  const notes = [];
  if (repairedCount > 0) {
    notes.push(`Ð›Ð¾ÐºÐ°Ð»ÑŒÐ½Ð¾ Ð¸ÑÐ¿Ñ€Ð°Ð²Ð»ÐµÐ½Ð¾ Ð²Ð¾Ð¿Ñ€Ð¾ÑÐ¾Ð² ÑÐ¾ ÑÐºÐ»ÐµÐµÐ½Ð½Ñ‹Ð¼Ð¸ Ð²Ð°Ñ€Ð¸Ð°Ð½Ñ‚Ð°Ð¼Ð¸ Ð¾Ñ‚Ð²ÐµÑ‚Ð¾Ð²: ${repairedCount}.`);
  }

  return {
    questions: repairedQuestions,
    notes,
  };
}

function stripEmbeddedPromptNumberMarkers(questionText) {
  const text = sanitizeText(questionText);
  if (!text) {
    return '';
  }

  return sanitizeText(text.replace(/\s+\d{1,3}[.)]\s+(.+)$/u, (match, tail) => {
    const normalizedTail = sanitizeText(tail);
    return normalizedTail && looksLikePromptSentence(normalizedTail) ? ` ${normalizedTail}` : match;
  }));
}

function extractTrailingOptionsFromQuestion(question, optionCount) {
  const questionText = sanitizeText(question?.q);
  const existingOptions = Array.isArray(question?.options)
    ? question.options.map((option) => sanitizeText(option)).filter(Boolean)
    : [];
  const minOptionCount = minimumAllowedOptionCount(optionCount);
  const expectedOptionCount = maximumAllowedOptionCount(optionCount);

  if (!questionText || existingOptions.length < Math.max(1, minOptionCount - 1) || expectedOptionCount < 2) {
    return null;
  }

  const boundaryIndexes = findPromptBoundaryCandidates(questionText);
  for (const boundaryIndex of boundaryIndexes) {
    const cleanQuestionText = sanitizeText(questionText.slice(0, boundaryIndex + 1));
    const leakedTail = sanitizeText(questionText.slice(boundaryIndex + 1));
    if (!cleanQuestionText || !leakedTail || !looksLikeRealQuestion(cleanQuestionText, existingOptions)) {
      continue;
    }

    const leakedOptions = collectStandaloneTailOptions(leakedTail, expectedOptionCount - existingOptions.length);
    if (!leakedOptions.length) {
      continue;
    }

    const combinedOptions = [...leakedOptions, ...existingOptions];
    if (!isAcceptableOptionCount(combinedOptions.length, optionCount)) {
      continue;
    }

    return {
      questionText: cleanQuestionText,
      options: combinedOptions,
    };
  }

  const titleBoundaryIndex = findPromptTitleBoundary(questionText);
  if (titleBoundaryIndex >= 0) {
    const cleanQuestionText = sanitizeText(questionText.slice(0, titleBoundaryIndex + 1));
    const leakedTail = sanitizeText(questionText.slice(titleBoundaryIndex + 1));
    if (cleanQuestionText && leakedTail && cleanQuestionText.length >= 20) {
      const leakedOptions = collectStandaloneTailOptions(leakedTail, expectedOptionCount - existingOptions.length);
      const combinedOptions = [...leakedOptions, ...existingOptions];
      if (leakedOptions.length && isAcceptableOptionCount(combinedOptions.length, optionCount)) {
        return {
          questionText: cleanQuestionText,
          options: combinedOptions,
        };
      }
    }
  }

  return null;
}

function findPromptBoundaryCandidates(text) {
  const value = String(text || '');
  const indexes = [];

  for (let index = 0; index < value.length - 1; index += 1) {
    if (!/[?.:]/.test(value[index])) {
      continue;
    }

    if (!/\s/.test(value[index + 1])) {
      continue;
    }

    indexes.push(index);
  }

  return indexes.reverse();
}

function collectStandaloneTailOptions(text, maxOptions) {
  const safeMaxOptions = Math.max(1, Number(maxOptions) || 0);
  const direct = sanitizeText(text);
  if (direct && (looksLikeStandaloneOptionLine(direct) || looksLikeLongStandaloneOptionText(direct))) {
    return [direct];
  }

  return splitLeadingTitlePhrases(text, safeMaxOptions)
    .map((option) => sanitizeText(option))
    .filter(Boolean)
    .filter((option) => looksLikeStandaloneOptionLine(option))
    .slice(0, safeMaxOptions);
}

function findPromptTitleBoundary(text) {
  const value = sanitizeText(text);
  if (!value) {
    return -1;
  }

  const lowerValue = value.toLowerCase();
  const markers = [' до ', ' для ', ' при ', ' після ', ' перед ', ' щодо ', ' про ', ' за ', ' від '];
  const titlePrefixes = ['дсанпін', 'дсту', 'дбн', 'закон', 'наказ', 'лист', 'санітарний', 'державні'];

  let bestBoundaryIndex = -1;

  for (const marker of markers) {
    const markerIndex = lowerValue.lastIndexOf(marker);
    if (markerIndex < 0) {
      continue;
    }

    const tailStart = markerIndex + marker.length;
    const tail = sanitizeText(value.slice(tailStart));
    if (!tail) {
      continue;
    }

    const lowerTail = tail.toLowerCase();
    if (!titlePrefixes.some((prefix) => lowerTail.startsWith(prefix))) {
      continue;
    }

    bestBoundaryIndex = Math.max(bestBoundaryIndex, markerIndex + marker.length - 2);
  }

  return bestBoundaryIndex;
}

function looksLikeLongStandaloneOptionText(text) {
  const value = sanitizeText(text);
  if (!value) {
    return false;
  }

  if (looksLikeQuestionTail(value) && looksLikePromptSentence(value)) {
    return false;
  }

  if (/[?:]$/.test(value)) {
    return false;
  }

  const wordCount = value.split(/\s+/).filter(Boolean).length;
  return wordCount >= 6 && value.length >= 45;
}

function repairShiftedQuestionLines(questions, optionCount) {
  const repairedQuestions = Array.isArray(questions)
    ? questions.map((question) => ({
      ...question,
      options: Array.isArray(question?.options) ? [...question.options] : [],
    }))
    : [];
  const notes = [];
  const minOptionCount = minimumAllowedOptionCount(optionCount);
  let movedIntoQuestionCount = 0;
  let movedToNextQuestionCount = 0;

  for (const question of repairedQuestions) {
    const questionText = sanitizeText(question?.q);
    const firstOption = sanitizeText(question?.options?.[0]);
    if (!questionText || !firstOption) {
      continue;
    }

    const firstOptionStartsLikeContinuation = /^[\p{Ll}\p{Lo}\d(]/u.test(firstOption)
      || /^[,;:)\]-]/u.test(firstOption);

    if (
      question.options.length > minOptionCount
      && !looksLikeQuestionTail(questionText)
      && !/[?]$/.test(questionText)
      && firstOptionStartsLikeContinuation
      && looksLikePromptSentence(firstOption)
      && (looksLikeQuestionTail(firstOption) || firstOption.length >= 55)
    ) {
      question.q = sanitizeText(`${questionText} ${firstOption}`);
      question.options.shift();
      question.correctIndex = Math.max(0, Math.min(question.options.length - 1, Number(question.correctIndex) || 0));
      movedIntoQuestionCount += 1;
    }
  }

  for (let index = 0; index < repairedQuestions.length - 1; index += 1) {
    const current = repairedQuestions[index];
    const next = repairedQuestions[index + 1];
    const lastOption = sanitizeText(current?.options?.at(-1));
    const nextQuestionText = sanitizeText(next?.q);
    if (!lastOption || !nextQuestionText) {
      continue;
    }

    const nextStartsLikeContinuation = /^[\p{Ll}\p{Lo}]/u.test(nextQuestionText)
      || /^[,;:)\]-]/u.test(nextQuestionText);
    const mergedQuestion = sanitizeText(`${lastOption} ${nextQuestionText}`);

    if (
      current.options.length > minOptionCount
      && lastOption.length >= 45
      && nextStartsLikeContinuation
      && looksLikePromptSentence(mergedQuestion)
      && looksLikeRealQuestion(mergedQuestion, next.options)
    ) {
      current.options.pop();
      current.correctIndex = Math.max(0, Math.min(current.options.length - 1, Number(current.correctIndex) || 0));
      next.q = mergedQuestion;
      movedToNextQuestionCount += 1;
    }
  }

  if (movedIntoQuestionCount > 0) {
    notes.push(`Repaired questions where the prompt started inside the first answer option: ${movedIntoQuestionCount}.`);
  }

  if (movedToNextQuestionCount > 0) {
    notes.push(`Repaired questions where the next prompt leaked into the last answer option: ${movedToNextQuestionCount}.`);
  }

  return {
    questions: repairedQuestions,
    notes,
  };
}

function repairQuestionTailOptionLeaks(questions, optionCount) {
  const repairedQuestions = Array.isArray(questions)
    ? questions.map((question) => ({
      ...question,
      options: Array.isArray(question?.options) ? [...question.options] : [],
    }))
    : [];
  const notes = [];
  const expectedOptionCount = maximumAllowedOptionCount(optionCount);
  let repairedCount = 0;

  if (expectedOptionCount !== 5) {
    return { questions: repairedQuestions, notes };
  }

  for (const question of repairedQuestions) {
    const questionText = sanitizeText(question?.q);
    const options = Array.isArray(question?.options)
      ? question.options.map((option) => sanitizeText(option)).filter(Boolean)
      : [];
    if (!questionText || options.length !== 4) {
      continue;
    }

    const titleBoundaryIndex = findPromptTitleBoundary(questionText);
    if (titleBoundaryIndex < 0) {
      continue;
    }

    const cleanQuestionText = sanitizeText(questionText.slice(0, titleBoundaryIndex + 1));
    const leakedOption = sanitizeText(questionText.slice(titleBoundaryIndex + 1));
    if (!cleanQuestionText || !looksLikeLongStandaloneOptionText(leakedOption)) {
      continue;
    }

    question.q = cleanQuestionText;
    question.options = [leakedOption, ...options];
    question.correctIndex = Math.max(0, Math.min(question.options.length - 1, Number(question.correctIndex) + 1 || 0));
    repairedCount += 1;
  }

  if (repairedCount > 0) {
    notes.push(`Recovered leaked leading answer options from question tails: ${repairedCount}.`);
  }

  return {
    questions: repairedQuestions,
    notes,
  };
}

function repairCrossQuestionLeadingOptionLeaks(questions, optionCount) {
  const repairedQuestions = Array.isArray(questions)
    ? questions.map((question) => ({
      ...question,
      options: Array.isArray(question?.options) ? [...question.options] : [],
    }))
    : [];
  const notes = [];
  const expectedOptionCount = maximumAllowedOptionCount(optionCount);
  let repairedCount = 0;

  if (expectedOptionCount !== 5) {
    return { questions: repairedQuestions, notes };
  }

  for (let index = 1; index < repairedQuestions.length; index += 1) {
    const previous = repairedQuestions[index - 1];
    const current = repairedQuestions[index];
    const previousOptions = Array.isArray(previous?.options)
      ? previous.options.map((option) => sanitizeText(option)).filter(Boolean)
      : [];
    const currentOptions = Array.isArray(current?.options)
      ? current.options.map((option) => sanitizeText(option)).filter(Boolean)
      : [];
    const missingCount = expectedOptionCount - previousOptions.length;

    if (missingCount < 1 || missingCount > 3 || currentOptions.length !== expectedOptionCount) {
      continue;
    }

    const splitLeak = splitLeadingOptionWithNumericFragments(currentOptions[0], missingCount);
    if (!splitLeak) {
      continue;
    }

    previous.options = [...splitLeak.leakedOptions, ...previousOptions].slice(0, expectedOptionCount);
    current.options = [splitLeak.currentOption, ...currentOptions.slice(1)];
    repairedCount += 1;
  }

  if (repairedCount > 0) {
    notes.push(`Recovered leaked answer options from the next question: ${repairedCount}.`);
  }

  return {
    questions: repairedQuestions,
    notes,
  };
}

function repairMissingNumberedQuestionsFromReviewBlocks(questions, reviewBlocks, optionCount, answerIndex) {
  const repairedQuestions = Array.isArray(questions)
    ? questions.map((question) => ({
      ...question,
      options: Array.isArray(question?.options) ? [...question.options] : [],
    }))
    : [];
  const notes = [];
  const expectedOptionCount = maximumAllowedOptionCount(optionCount);

  if (expectedOptionCount !== 5 || !Array.isArray(reviewBlocks) || !reviewBlocks.length) {
    return { questions: repairedQuestions, notes };
  }

  const availableBlocks = reviewBlocks
    .filter((block) => /raw-explicit-number-block|explicit-number-block/i.test(String(block?.reason || '')))
    .map((block, index) => ({ ...block, __index: index }))
    .filter((block) => sanitizeText(block?.text));
  if (!availableBlocks.length) {
    return { questions: repairedQuestions, notes };
  }

  const consumedBlockIndexes = new Set();
  let repairedCount = 0;

  for (let index = 1; index < repairedQuestions.length; index += 1) {
    const previous = repairedQuestions[index - 1];
    const current = repairedQuestions[index];
    const previousNumber = extractLeadingQuestionNumber(previous?.q);
    const currentNumber = extractLeadingQuestionNumber(current?.q);

    if (!Number.isInteger(previousNumber) || !Number.isInteger(currentNumber) || currentNumber !== previousNumber + 2) {
      continue;
    }

    const missingNumber = previousNumber + 1;
    const currentOptions = Array.isArray(current?.options)
      ? current.options.map((option) => sanitizeText(option)).filter(Boolean)
      : [];
    if (currentOptions.length !== expectedOptionCount) {
      continue;
    }

    let recovered = null;
    let recoveredBlockIndex = -1;
    for (const block of availableBlocks) {
      if (consumedBlockIndexes.has(block.__index)) {
        continue;
      }

      const candidate = recoverMissingQuestionFromReviewBlock(
        block.text,
        missingNumber,
        currentOptions[0],
        expectedOptionCount,
        answerIndex,
      );
      if (candidate) {
        recovered = candidate;
        recoveredBlockIndex = block.__index;
        break;
      }
    }

    if (!recovered) {
      continue;
    }

    consumedBlockIndexes.add(recoveredBlockIndex);
    current.options = [recovered.currentFirstOption, ...currentOptions.slice(1)];
    repairedQuestions.splice(index, 0, recovered.question);
    repairedCount += 1;
    index += 1;
  }

  if (repairedCount > 0) {
    notes.push(`Recovered dropped numbered questions from review blocks: ${repairedCount}.`);
  }

  return {
    questions: repairedQuestions,
    notes,
  };
}

function splitLeadingOptionWithNumericFragments(optionText, missingCount) {
  const text = sanitizeText(optionText);
  if (!text || !Number.isInteger(missingCount) || missingCount < 1) {
    return null;
  }

  const matches = [];
  const numericRangePattern = /\d+\s*[\u2010-\u2015\u2212-]\s*\d+(?:\s+[^\d]+?)(?=(?:\s+\d+\s*[\u2010-\u2015\u2212-]\s*\d+\b)|$)/gu;
  let match;
  while ((match = numericRangePattern.exec(text)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      value: sanitizeText(match[0]),
    });
  }

  if (matches.length !== missingCount) {
    return null;
  }

  const currentOption = sanitizeText(text.slice(0, matches[0].start));
  if (!currentOption || !looksLikeStandaloneOptionLine(currentOption)) {
    return null;
  }

  const leakedOptions = matches.map((item) => item.value).filter(Boolean);
  if (leakedOptions.length !== missingCount || !leakedOptions.every((item) => looksLikeStandaloneOptionLine(item))) {
    return null;
  }

  return {
    currentOption,
    leakedOptions,
  };
}

function recoverMissingQuestionFromReviewBlock(reviewText, missingNumber, currentFirstOption, expectedOptionCount, answerIndex) {
  const text = sanitizeText(reviewText);
  if (!text || !Number.isInteger(missingNumber)) {
    return null;
  }

  const questionBoundaryIndex = findReviewBlockQuestionBoundary(text);
  if (questionBoundaryIndex < 0) {
    return null;
  }

  const questionText = sanitizeText(text.slice(0, questionBoundaryIndex + 1));
  const tailText = sanitizeText(text.slice(questionBoundaryIndex + 1));
  const recoveredTailOptions = extractNumericRangeOptions(tailText);
  if (!questionText || !recoveredTailOptions.length || recoveredTailOptions.length >= expectedOptionCount) {
    return null;
  }

  const missingCount = expectedOptionCount - recoveredTailOptions.length;
  const splitLeak = splitLeadingOptionWithNumericFragments(currentFirstOption, missingCount);
  if (!splitLeak) {
    return null;
  }

  const options = [...splitLeak.leakedOptions, ...recoveredTailOptions].slice(0, expectedOptionCount);
  if (options.length !== expectedOptionCount) {
    return null;
  }

  return {
    currentFirstOption: splitLeak.currentOption,
    question: {
      q: `${missingNumber}. ${questionText}`,
      options,
      correctIndex: resolveQuestionCorrectIndex(answerIndex, expectedOptionCount),
      sourceQuestionNumber: missingNumber,
    },
  };
}

function findReviewBlockQuestionBoundary(text) {
  const value = sanitizeText(text);
  if (!value) {
    return -1;
  }

  const colonIndex = value.lastIndexOf(':');
  if (colonIndex >= 0) {
    return colonIndex;
  }

  const questionIndex = value.lastIndexOf('?');
  return questionIndex >= 0 ? questionIndex : -1;
}

function extractNumericRangeOptions(text) {
  const normalized = sanitizeText(text);
  if (!normalized) {
    return [];
  }

  const matches = [];
  const numericRangePattern = /\d+\s*[\u2010-\u2015\u2212-]\s*\d+(?:\s+[^\d]+?)(?=(?:\s+\d+\s*[\u2010-\u2015\u2212-]\s*\d+\b)|$)/gu;
  let match;
  while ((match = numericRangePattern.exec(normalized)) !== null) {
    const value = sanitizeText(String(match[0] || '').replace(/[\uE000-\uF8FF]+/gu, ' '));
    if (value) {
      matches.push(value);
    }
  }

  return matches;
}

function repairNormalizedQuestionTailOptionLeaks(questions, optionCount) {
  const repairedQuestions = Array.isArray(questions)
    ? questions.map((question) => ({
      ...question,
      options: Array.isArray(question?.options) ? [...question.options] : [],
    }))
    : [];
  const notes = [];
  const expectedOptionCount = maximumAllowedOptionCount(optionCount);
  let repairedCount = 0;

  if (expectedOptionCount !== 5) {
    return { questions: repairedQuestions, notes };
  }

  for (const question of repairedQuestions) {
    const questionText = sanitizeText(question?.q);
    const options = Array.isArray(question?.options)
      ? question.options.map((option) => sanitizeText(option))
      : [];
    const nonEmptyOptions = options.filter(Boolean);
    if (!questionText || nonEmptyOptions.length !== 4 || options.at(-1)) {
      continue;
    }

    const titleBoundaryIndex = findPromptTitleBoundary(questionText);
    if (titleBoundaryIndex < 0) {
      continue;
    }

    const cleanQuestionText = sanitizeText(questionText.slice(0, titleBoundaryIndex + 1));
    const leakedOption = sanitizeText(questionText.slice(titleBoundaryIndex + 1));
    if (!cleanQuestionText || !looksLikeLongStandaloneOptionText(leakedOption)) {
      continue;
    }

    question.q = cleanQuestionText;
    question.options = [leakedOption, ...nonEmptyOptions].slice(0, expectedOptionCount);
    question.correctIndex = Math.max(0, Math.min(question.options.length - 1, Number(question.correctIndex) + 1 || 0));
    repairedCount += 1;
  }

  if (repairedCount > 0) {
    notes.push(`Recovered leaked leading answer options after normalization: ${repairedCount}.`);
  }

  return {
    questions: repairedQuestions,
    notes,
  };
}

function extractQuestionOptionsLeakedIntoPrompt(question, optionCount) {
  const questionText = sanitizeText(question?.q);
  const existingOptions = Array.isArray(question?.options)
    ? question.options.map((option) => sanitizeText(option)).filter(Boolean)
    : [];
  const expectedOptionCount = maximumAllowedOptionCount(optionCount);

  if (!questionText || existingOptions.length < 2 || expectedOptionCount < 4) {
    return null;
  }

  const promptEndIndex = findFirstPromptBoundary(questionText);
  if (promptEndIndex < 0 || promptEndIndex >= questionText.length - 1) {
    return null;
  }

  const cleanQuestionText = sanitizeText(questionText.slice(0, promptEndIndex + 1));
  const leakedTail = sanitizeText(questionText.slice(promptEndIndex + 1));
  if (!cleanQuestionText || !leakedTail) {
    return null;
  }

  const leakedCandidates = leakedTail
    .split(/(?<=[.?!;:])\s+(?=[\p{Lu}])/u)
    .map((option) => sanitizeText(option))
    .filter(Boolean);
  const leakedOptions = (leakedCandidates.length > 1 ? leakedCandidates : splitLeadingTitlePhrases(leakedTail, expectedOptionCount + 2))
    .map((option) => sanitizeText(option))
    .filter(Boolean)
    .filter((option) => looksLikeStandaloneOptionLine(option));

  if (!leakedOptions.length) {
    return null;
  }

  const combinedOptions = [...leakedOptions, ...existingOptions]
    .filter((option) => !/^\d{1,3}[.)]?$/.test(option));

  while (
    combinedOptions.length > expectedOptionCount
    && combinedOptions.at(-1)
    && looksLikePromptSentence(combinedOptions.at(-1))
    && combinedOptions.at(-1).length >= 40
  ) {
    combinedOptions.pop();
  }

  if (!isAcceptableOptionCount(combinedOptions.length, optionCount) || !looksLikeRealQuestion(cleanQuestionText, combinedOptions)) {
    return null;
  }

  return {
    questionText: cleanQuestionText,
    options: combinedOptions,
  };
}

function extractQuestionContinuationFromOptions(question, optionCount) {
  const questionText = sanitizeText(question?.q);
  const options = Array.isArray(question?.options)
    ? question.options.map((option) => sanitizeText(option)).filter(Boolean)
    : [];

  if (!questionText || options.length < 4) {
    return null;
  }

  const promptLooksOpen = /[:;,]$/.test(questionText) || !/[.?!]$/.test(questionText);
  const minOptionCount = minimumAllowedOptionCount(optionCount);

  for (let index = 0; index < options.length; index += 1) {
    const candidate = options[index];
    const candidateEndsWithQuestion = /[?]$/.test(candidate);
    if (!candidate || (!candidateEndsWithQuestion && candidate.length < 45)) {
      continue;
    }

    if (!looksLikePromptSentence(candidate) && !looksLikeQuestionTail(candidate)) {
      continue;
    }

    if (!promptLooksOpen && !/[?]$/.test(candidate)) {
      continue;
    }

    const remainingOptions = options.filter((_, optionIndex) => optionIndex !== index);
    if (remainingOptions.length < minOptionCount || !isAcceptableOptionCount(remainingOptions.length, optionCount)) {
      continue;
    }

    const remainingLengths = remainingOptions.map((option) => option.length).filter(Boolean);
    const maxRemainingLength = remainingLengths.length ? Math.max(...remainingLengths) : 0;
    const shortRemainingCount = remainingOptions.filter((option) => option.length <= 80 && !looksLikeQuestionTail(option)).length;
    if (!candidateEndsWithQuestion && candidate.length < Math.max(60, Math.round(maxRemainingLength * 1.8))) {
      continue;
    }

    if (shortRemainingCount < Math.max(2, remainingOptions.length - 1)) {
      continue;
    }

    const mergedQuestion = sanitizeText(`${questionText} ${candidate}`);
    if (!looksLikeRealQuestion(mergedQuestion, remainingOptions)) {
      continue;
    }

    return {
      questionText: mergedQuestion,
      options: remainingOptions,
    };
  }

  return null;
}

function extractEmbeddedQuestion(questionText, optionCount) {
  const text = sanitizeText(questionText);
  const minOptionCount = minimumAllowedOptionCount(optionCount);
  const maxOptionCount = maximumAllowedOptionCount(optionCount);
  if (!text || minOptionCount < 3) {
    return null;
  }

  const recoveredByBoundary = extractEmbeddedQuestionByTitleBoundary(text, optionCount);
  if (recoveredByBoundary) {
    return recoveredByBoundary;
  }

  const promptEndIndex = findFirstPromptBoundary(text);
  if (promptEndIndex < 0) {
    return null;
  }

  const questionPart = sanitizeText(text.slice(0, promptEndIndex + 1));
  const trailing = sanitizeText(text.slice(promptEndIndex + 1));
  if (!questionPart || !trailing) {
    return null;
  }

  const phrases = splitLeadingTitlePhrases(trailing, maxOptionCount + 2);
  if (phrases.length <= minOptionCount) {
    return null;
  }

  for (let takeCount = Math.min(maxOptionCount, phrases.length - 1); takeCount >= minOptionCount; takeCount -= 1) {
    const options = phrases.slice(0, takeCount);
    const remainder = sanitizeText(phrases.slice(takeCount).join(' '));

    if (!remainder || (!looksLikePromptSentence(remainder) && !looksLikeQuestionTail(remainder))) {
      continue;
    }

    if (!options.every((option) => looksLikeStandaloneOptionLine(option))) {
      continue;
    }

    if (!looksLikeRealQuestion(questionPart, options)) {
      continue;
    }

    return {
      questionText: questionPart,
      options,
      leakedPrompt: remainder,
    };
  }

  return null;
}

function extractEmbeddedQuestionByTitleBoundary(text, optionCount) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const minOptionCount = minimumAllowedOptionCount(optionCount);
  const maxOptionCount = maximumAllowedOptionCount(optionCount);

  for (let startIndex = 4; startIndex <= words.length - (minOptionCount + 2); startIndex += 1) {
    if (!startsWithUppercase(words[startIndex])) {
      continue;
    }

    const questionPart = sanitizeText(words.slice(0, startIndex).join(' '));
    if (!questionPart || questionPart.length < 40 || !looksLikePromptSentence(questionPart)) {
      continue;
    }

    const trailing = sanitizeText(words.slice(startIndex).join(' '));
    const phrases = splitLeadingTitlePhrases(trailing, maxOptionCount + 2);
    if (phrases.length <= minOptionCount) {
      continue;
    }

    for (let takeCount = Math.min(maxOptionCount, phrases.length - 1); takeCount >= minOptionCount; takeCount -= 1) {
      const options = phrases.slice(0, takeCount);
      const remainder = sanitizeText(phrases.slice(takeCount).join(' '));

      if (!remainder || (!looksLikePromptSentence(remainder) && !looksLikeQuestionTail(remainder))) {
        continue;
      }

      if (!options.every((option) => looksLikeStandaloneOptionLine(option))) {
        continue;
      }

      if (!looksLikeRealQuestion(questionPart, options)) {
        continue;
      }

      return {
        questionText: questionPart,
        options,
        leakedPrompt: remainder,
      };
    }
  }

  return null;
}

function findFirstPromptBoundary(text) {
  const value = String(text || '');
  const questionMarkIndex = value.indexOf('?');
  if (questionMarkIndex >= 0) {
    return questionMarkIndex;
  }

  const colonIndex = value.indexOf(':');
  if (colonIndex >= 0 && looksLikePromptSentence(value.slice(0, colonIndex + 1))) {
    return colonIndex;
  }

  return -1;
}

function detectLeadingOptionLeak(questionText, optionCount) {
  const text = sanitizeText(questionText);
  const minOptionCount = minimumAllowedOptionCount(optionCount);
  const maxOptionCount = maximumAllowedOptionCount(optionCount);
  if (!text || minOptionCount < 3) {
    return null;
  }

  const phrases = splitLeadingTitlePhrases(text, maxOptionCount + 2);
  if (phrases.length <= minOptionCount) {
    return null;
  }

  for (let leakCount = Math.min(maxOptionCount, phrases.length - 1); leakCount >= minOptionCount; leakCount -= 1) {
    const leakedOptions = phrases.slice(0, leakCount);
    const rest = sanitizeText(phrases.slice(leakCount).join(' '));

    if (!rest || (!looksLikePromptSentence(rest) && !looksLikeQuestionTail(rest))) {
      continue;
    }

    if (!leakedOptions.every((option) => looksLikeStandaloneOptionLine(option))) {
      continue;
    }

    return {
      leakedOptionCount: leakCount,
      leakedOptions,
      promptRemainder: rest,
    };
  }

  return null;
}

function splitLeadingTitlePhrases(text, maxPhrases) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const phrases = [];
  let current = [];

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    current.push(word);

    const next = words[index + 1];
    const afterNext = words[index + 2];
    if (!next) {
      break;
    }

    if (!isLikelyTitlePhraseBoundary(current, next, afterNext)) {
      continue;
    }

    phrases.push(current.join(' '));
    current = [];

    if (phrases.length >= maxPhrases) {
      break;
    }
  }

  if (current.length && phrases.length < maxPhrases + 1) {
    phrases.push(current.join(' '));
  }

  return phrases;
}

function isLikelyTitlePhraseBoundary(currentWords, nextWord, afterNextWord) {
  if (!Array.isArray(currentWords) || !currentWords.length) {
    return false;
  }

  if (!startsWithUppercase(nextWord)) {
    return false;
  }

  const currentLast = currentWords.at(-1) || '';
  if (/[?.!:;]$/.test(currentLast)) {
    return false;
  }

  if (currentWords.length >= 6) {
    return true;
  }

  if (currentWords.length >= 2 && /^\p{Ll}/u.test(currentLast)) {
    return true;
  }

  if (currentWords.length === 1 && /^\p{Lu}{2,4}$/u.test(String(nextWord || ''))) {
    return false;
  }

  if (looksLikeStandaloneOptionLine(currentWords.join(' '))) {
    return true;
  }

  if (currentWords.length === 1 && !/^\p{Lu}{2,}$/u.test(currentLast)) {
    return false;
  }

  if (!afterNextWord) {
    return true;
  }

  return /^\p{Ll}/u.test(afterNextWord) || /^\p{Lu}{2,}$/u.test(nextWord);
}

function startsWithUppercase(word) {
  return /^\p{Lu}/u.test(String(word || ''));
}

function parseAutoQuestionBlock(lines) {
  const cleanLines = dedupeAdjacentLines(
    (Array.isArray(lines) ? lines : [lines])
      .map((line) => sanitizeText(line))
      .filter(Boolean),
  );

  if (cleanLines.length < AUTO_OPTION_MIN + 1) {
    return null;
  }

  let best = null;

  for (let splitIndex = 0; splitIndex <= cleanLines.length - AUTO_OPTION_MIN - 1; splitIndex += 1) {
    const questionLines = cleanLines.slice(0, splitIndex + 1);
    const rawOptionLines = cleanLines.slice(splitIndex + 1);
    const questionText = sanitizeText(questionLines.join(' '));
    const optionLines = normalizeAutoOptionLines(rawOptionLines);

    if (!questionText || !isAcceptableOptionCount(optionLines.length, AUTO_OPTION_COUNT)) {
      continue;
    }

    const autoOptionCountScore = optionLines.length >= 4 ? 60 : -45;
    const score = scoreExplicitQuestionBoundary(
      questionLines,
      optionLines,
      questionText,
      rawOptionLines,
      Math.max(optionLines.length, AUTO_OPTION_MIN),
    ) + optionLines.length * 4 - Math.abs(optionLines.length - 5) * 3 + autoOptionCountScore;

    if (!best || score > best.score) {
      best = {
        q: questionText,
        options: optionLines,
        score,
      };
    }
  }

  return best ? { q: best.q, options: best.options } : null;
}

function normalizeAutoOptionLines(lines) {
  const cleanLines = dedupeAdjacentLines(
    (Array.isArray(lines) ? lines : [lines])
      .map((line) => sanitizeText(line))
      .filter(Boolean)
      .filter((line) => !shouldIgnoreLine(line, { allowNumeric: true })),
  );

  if (cleanLines.length < AUTO_OPTION_MIN) {
    return [];
  }

  const repartitionedFive = repartitionAutoOverflowOptions(cleanLines, 5);
  if (repartitionedFive) {
    return repartitionedFive;
  }

  const groupedByMarkers = groupOptionLinesByMarkers(cleanLines);
  if (isAcceptableOptionCount(groupedByMarkers.length, AUTO_OPTION_COUNT)) {
    return groupedByMarkers;
  }

  const groupedByStandalone = groupOptionLinesByStandalone(cleanLines);
  if (isAcceptableOptionCount(groupedByStandalone.length, AUTO_OPTION_COUNT)) {
    return groupedByStandalone;
  }

  const entries = cleanLines.map((line, index) => ({ index, line }));
  const recovered = partitionRecoveredOptionsAuto(entries);
  if (isAcceptableOptionCount(recovered.length, AUTO_OPTION_COUNT)) {
    return recovered;
  }

  return [];
}

function repartitionAutoOverflowOptions(lines, targetCount) {
  const cleanLines = Array.isArray(lines) ? lines.map((line) => sanitizeText(line)).filter(Boolean) : [];
  if (!Number.isInteger(targetCount) || targetCount < 2) {
    return null;
  }

  if (cleanLines.length <= targetCount || cleanLines.length > targetCount * 2) {
    return null;
  }

  const hasShortLowercaseFragments = cleanLines.some((line) => {
    const words = line.split(/\s+/).filter(Boolean).length;
    return /^[\p{Ll}\p{Lo}]/u.test(line) && words <= 3 && line.length <= 36;
  });

  if (!hasShortLowercaseFragments) {
    return null;
  }

  const entries = cleanLines.map((line) => ({ line }));
  const resolved = partitionRecoveredOptionsWithValidator(entries, targetCount, isValidAutoOverflowChunk);
  return resolved && resolved.length === targetCount ? resolved : null;
}

function partitionRecoveredOptionsWithValidator(entries, optionCount, validator) {
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
      if (!validator(chunk)) {
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

function groupOptionLinesByMarkers(lines) {
  const grouped = [];
  let current = '';
  let sawMarker = false;

  for (const rawLine of lines) {
    const optionMatch = matchOptionStart(rawLine, AUTO_OPTION_COUNT);
    const optionText = sanitizeText(optionMatch ? optionMatch.text : rawLine);
    if (!optionText) {
      continue;
    }

    if (optionMatch) {
      if (current) {
        grouped.push(current);
      }
      current = optionText;
      sawMarker = true;
      continue;
    }

    if (!current) {
      current = optionText;
      continue;
    }

    if (shouldContinueAutoOptionText(current, optionText) || !looksLikeStandaloneOptionLine(optionText)) {
      current = joinFragments(current, optionText);
      continue;
    }

    grouped.push(current);
    current = optionText;
  }

  if (current) {
    grouped.push(current);
  }

  return sawMarker ? grouped.slice(0, AUTO_OPTION_MAX) : [];
}

function groupOptionLinesByStandalone(lines) {
  const grouped = [];
  let current = '';

  for (const rawLine of lines) {
    const optionText = sanitizeText(rawLine);
    if (!optionText) {
      continue;
    }

    if (!current) {
      current = optionText;
      continue;
    }

    if (shouldContinueAutoOptionText(current, optionText) || !looksLikeStandaloneOptionLine(optionText)) {
      current = joinFragments(current, optionText);
      continue;
    }

    grouped.push(current);
    current = optionText;
  }

  if (current) {
    grouped.push(current);
  }

  return grouped.slice(0, AUTO_OPTION_MAX);
}

function partitionRecoveredOptionsAuto(entries) {
  let best = [];

  for (let optionCount = AUTO_OPTION_MIN; optionCount <= Math.min(entries.length, AUTO_OPTION_MAX); optionCount += 1) {
    const resolved = partitionRecoveredOptions(entries, optionCount);
    if (!resolved) {
      continue;
    }

    if (!best.length || resolved.length > best.length || Math.abs(resolved.length - 5) < Math.abs(best.length - 5)) {
      best = resolved;
    }
  }

  return best;
}

function parseLineBlock(lines, optionCount) {
  const cleanLines = dedupeAdjacentLines(
    lines.map((line) => sanitizeText(line)).filter(Boolean),
  );

  if (cleanLines.length < minimumAllowedOptionCount(optionCount) + 1) {
    return null;
  }

  if (isAutoOptionCount(optionCount)) {
    return parseAutoQuestionBlock(cleanLines);
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

  if (!questionText || !isAcceptableOptionCount(options.length, optionCount)) {
    return null;
  }

  return { q: questionText, options };
}

function parseExplicitNumberBlock(lines, optionCount) {
  const cleanLines = normalizeBlockLines(lines);
  if (cleanLines.length < minimumAllowedOptionCount(optionCount) + 1) {
    return null;
  }

  if (isAutoOptionCount(optionCount)) {
    return parseAutoQuestionBlock(cleanLines);
  }

  const splitIndex = findExplicitQuestionOptionBoundary(cleanLines, optionCount);
  if (splitIndex < 0) {
    return null;
  }

  const resolvedSplitIndex = refineExplicitQuestionOptionBoundary(cleanLines, splitIndex, optionCount);
  const questionText = sanitizeText(cleanLines.slice(0, resolvedSplitIndex + 1).join(' '));
  const optionLines = normalizeOptionLines(cleanLines.slice(resolvedSplitIndex + 1), optionCount);

  if (!questionText || !isAcceptableOptionCount(optionLines.length, optionCount)) {
    return null;
  }

  return {
    q: questionText,
    options: optionLines,
  };
}

function refineExplicitQuestionOptionBoundary(lines, splitIndex, optionCount) {
  const expectedOptionCount = maximumAllowedOptionCount(optionCount);
  const minimumOptionCount = minimumAllowedOptionCount(optionCount);
  if (expectedOptionCount !== 5 || minimumOptionCount !== 4) {
    return splitIndex;
  }

  const currentRawOptionLines = lines.slice(splitIndex + 1);
  const currentOptions = normalizeOptionLines(currentRawOptionLines, optionCount);
  const currentMergedOptions = mergeWrappedOptionLines(currentRawOptionLines, optionCount);
  const shouldRefine = currentOptions.length === minimumOptionCount || currentMergedOptions.length > expectedOptionCount;
  if (!shouldRefine) {
    return splitIndex;
  }

  let bestSplitIndex = splitIndex;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let candidateSplitIndex = Math.max(0, splitIndex - 3); candidateSplitIndex < splitIndex; candidateSplitIndex += 1) {
    const questionLines = lines.slice(0, candidateSplitIndex + 1);
    const rawOptionLines = lines.slice(candidateSplitIndex + 1);
    const optionLines = normalizeOptionLines(rawOptionLines, optionCount);
    const questionText = sanitizeText(questionLines.join(' '));
    if (!questionText || optionLines.length !== expectedOptionCount) {
      continue;
    }

    if (rawOptionLines[0] && /^[\p{Ll}\p{Lo}]/u.test(rawOptionLines[0])) {
      continue;
    }

    const score = scoreExplicitQuestionBoundary(questionLines, optionLines, questionText, rawOptionLines, optionCount) + 25;
    if (score > bestScore) {
      bestScore = score;
      bestSplitIndex = candidateSplitIndex;
    }
  }

  return bestSplitIndex;
}

function findExplicitQuestionOptionBoundary(lines, optionCount) {
  const minOptionCount = minimumAllowedOptionCount(optionCount);
  const directBoundary = findQuestionOptionBoundary(lines, optionCount);
  if (directBoundary >= 0 && looksLikeQuestionTail(lines[directBoundary])) {
    return directBoundary;
  }

  let best = null;

  for (let splitIndex = 0; splitIndex <= lines.length - minOptionCount - 1; splitIndex += 1) {
    const questionLines = lines.slice(0, splitIndex + 1);
    const rawOptionLines = lines.slice(splitIndex + 1);
    const optionLines = normalizeOptionLines(rawOptionLines, optionCount);
    const questionText = sanitizeText(questionLines.join(' '));

    if (!questionText || !isAcceptableOptionCount(optionLines.length, optionCount)) {
      continue;
    }

    const score = scoreExplicitQuestionBoundary(questionLines, optionLines, questionText, rawOptionLines, optionCount);
    if (!best || score > best.score) {
      best = { splitIndex, score };
    }
  }

  if (best) {
    return best.splitIndex;
  }

  return findQuestionOptionBoundary(lines, optionCount);
}

function scoreExplicitQuestionBoundary(questionLines, optionLines, questionText, rawOptionLines, optionCount) {
  let score = 0;

  if (looksLikeQuestionTail(questionLines.at(-1))) {
    score += 20;
  }

  if (looksLikePromptSentence(questionText)) {
    score += 15;
  }

  if (looksLikeRealQuestion(questionText, optionLines)) {
    score += 10;
  }

  if (isAcceptableOptionCount(optionLines.length, optionCount)) {
    score += 8;
  }

  if (rawOptionLines.length > optionLines.length) {
    score += Math.min(6, rawOptionLines.length - optionLines.length);
  }

  if (optionLines.every((option) => looksLikeStandaloneOptionLine(option))) {
    score += 8;
  }

  const firstOption = sanitizeText(optionLines[0]);
  const firstTwoOptions = sanitizeText(optionLines.slice(0, 2).join(' '));
  if (looksLikePromptSentence(firstOption) || (firstTwoOptions && looksLikePromptSentence(firstTwoOptions) && /[?.:]$/.test(firstTwoOptions))) {
    score -= 30;
  }

  if (rawOptionLines[0] && /^\p{Ll}/u.test(rawOptionLines[0])) {
    score -= 25;
    if (!looksLikeQuestionTail(questionText)) {
      score -= 30;
    }
    if (/[,:;]$/.test(sanitizeText(questionLines.at(-1)))) {
      score -= 25;
    }
  }

  if (optionLines.length === optionCount) {
    score += 40;
  } else if (optionLines.length === minimumAllowedOptionCount(optionCount)) {
    score -= 10;
  }

  if (optionLines.some((option) => looksLikeQuestionTail(option) && looksLikePromptSentence(option))) {
    score -= 20;
  }

  if (questionLines.length === 1) {
    score += 4;
  }

  if (questionLines.length > 8) {
    score -= questionLines.length - 8;
  }

  return score;
}

function collectSequentialOptions(lines, startIndex, optionCount) {
  if (isAutoOptionCount(optionCount)) {
    return collectSequentialOptionsAuto(lines, startIndex);
  }

  return collectSequentialOptionsFlexible(lines, startIndex, optionCount)
    || collectSequentialOptionsStrict(lines, startIndex, optionCount)
    || recoverSequentialOptionsWindow(lines, startIndex, optionCount);
}

function collectSequentialOptionsAuto(lines, startIndex) {
  const optionEntries = [];
  let nextIndex = startIndex;

  for (let index = startIndex; index < lines.length && optionEntries.length < AUTO_OPTION_MAX * 3 + 6; index += 1) {
    const line = lines[index];
    if (!line || shouldIgnoreLine(line) || isLikelyTopicHeading(line)) {
      nextIndex = index + 1;
      continue;
    }

    if (matchQuestionStart(line) || matchStandaloneQuestionStart(line)) {
      nextIndex = index;
      break;
    }

    const optionText = sanitizeText(line);
    if (!optionText) {
      nextIndex = index + 1;
      continue;
    }

    const nextEntries = findNextMeaningfulOptionEntries(lines, index + 1, 2);
    if (
      optionEntries.length >= Math.max(AUTO_OPTION_MIN, 4)
      && !looksLikeStandaloneOptionLine(optionText)
      && looksLikePotentialQuestionStart(
        { line: optionText },
        nextEntries.length ? { line: nextEntries.map((entry) => entry.line).join(' ') } : null,
      )
    ) {
      nextIndex = index;
      break;
    }

    if (
      optionEntries.length >= AUTO_OPTION_MIN
      && looksLikeWrappedQuestionLead(lines, index)
    ) {
      nextIndex = index;
      break;
    }

    if (
      optionEntries.length >= AUTO_OPTION_MIN
      && looksLikeQuestionTail(optionText)
      && looksLikePromptSentence(optionText)
    ) {
      nextIndex = index;
      break;
    }

    optionEntries.push({
      index,
      line: optionText,
    });
    nextIndex = index + 1;
  }

  if (optionEntries.length < AUTO_OPTION_MIN) {
    return null;
  }

  const options = normalizeAutoOptionLines(optionEntries.map((entry) => entry.line));
  if (!isAcceptableOptionCount(options.length, AUTO_OPTION_COUNT)) {
    return null;
  }

  return {
    options,
    nextIndex,
  };
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

    if (!optionMatch && !looksLikeStandaloneOptionLine(line) && !looksLikeLongStandaloneOptionText(line)) {
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
    if (!optionMatch && !currentOption && !looksLikeStandaloneOptionLine(line) && !looksLikeLongStandaloneOptionText(line)) {
      break;
    }

    const optionText = sanitizeText(optionMatch ? optionMatch.text : line);
    if (!optionText) {
      index += 1;
      continue;
    }

    if (
      !optionMatch
      && currentOption
      && options.length + 1 >= optionCount
      && !shouldContinueOptionText(currentOption, optionText)
    ) {
      options.push(currentOption);
      break;
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

  if (/[,:((\/\[]$/u.test(current) || new RegExp(`[${DASH_CHARS}]$`).test(current)) {
    return true;
  }

  if (/^[\p{Ll}\p{Lo}]/u.test(next)) {
    return true;
  }

  return false;
}

function shouldContinueAutoOptionText(currentOption, nextLine) {
  const current = sanitizeText(currentOption);
  const next = sanitizeText(nextLine);

  if (!current || !next) {
    return false;
  }

  if (/[,:((\/\[]$/u.test(current) || new RegExp(`[${DASH_CHARS}]$`).test(current)) {
    return true;
  }

  if (looksLikeOverflowOptionContinuation(current, next)) {
    return true;
  }

  const nextWords = next.split(/\s+/).filter(Boolean).length;
  if (
    /^[\p{Ll}\p{Lo}]/u.test(next)
    && nextWords <= 4
    && next.length <= 36
    && (
      (nextWords > 1 && !looksLikeStandaloneOptionLine(current))
      || endsWithOptionContinuationCue(current)
    )
  ) {
    return true;
  }

  return false;
}

function endsWithOptionContinuationCue(text) {
  const value = sanitizeText(text);
  if (!value) {
    return false;
  }

  const lastWord = value.split(/\s+/).filter(Boolean).at(-1) || '';
  return /^(попереду|позаду|перед|після|для|до|з|із|над|під)$/iu.test(lastWord)
    || (/^\p{Ll}/u.test(lastWord) && /(?:им|ім|їм|ою|ею)$/iu.test(lastWord));
}

function looksLikeStandaloneOptionLine(line) {
  const text = sanitizeText(line);
  if (!text) {
    return false;
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (/\.$/.test(text) && wordCount <= 8 && text.length <= 100) {
    return true;
  }

  if (looksLikeQuestionTail(text) && looksLikePromptSentence(text)) {
    return false;
  }

  if (/[?:]$/.test(text)) {
    return false;
  }

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
    return looksLikeStandaloneOptionLine(chunk[0]) || looksLikeLongStandaloneOptionText(chunk[0]);
  }

  for (let index = 1; index < chunk.length; index += 1) {
    if (!shouldContinueOptionText(chunk[index - 1], chunk[index])) {
      return false;
    }
  }

  return true;
}

function isValidAutoOverflowChunk(chunk) {
  if (!Array.isArray(chunk) || !chunk.length) {
    return false;
  }

  if (chunk.length === 1) {
    const text = sanitizeText(chunk[0]);
    const words = text.split(/\s+/).filter(Boolean).length;
    if (/^[\p{Ll}\p{Lo}]/u.test(text) && words <= 3 && text.length <= 36) {
      return false;
    }
    return looksLikeStandaloneOptionLine(text) || looksLikeLongStandaloneOptionText(text) || words >= 4;
  }

  for (let index = 1; index < chunk.length; index += 1) {
    if (!shouldContinueAutoOptionText(chunk[index - 1], chunk[index]) && !looksLikeOverflowOptionContinuation(chunk[index - 1], chunk[index])) {
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

function looksLikeWrappedQuestionLead(lines, startIndex) {
  const fragments = [];

  for (let index = startIndex; index < lines.length && fragments.length < 3; index += 1) {
    const line = sanitizeText(lines[index]);
    if (!line || shouldIgnoreLine(line)) {
      continue;
    }

    if (matchQuestionStart(line) || matchStandaloneQuestionStart(line)) {
      return true;
    }

    fragments.push(line);
    const combined = sanitizeText(fragments.join(' '));
    if (!combined || !looksLikePromptSentence(combined)) {
      continue;
    }

    const firstFragment = fragments[0];
    if (firstFragment.length < 55) {
      continue;
    }

    const tail = fragments.at(-1);
    if (looksLikeQuestionTail(tail) || /[.?:]$/.test(tail) || (fragments.length >= 2 && combined.length >= 80)) {
      return true;
    }
  }

  return false;
}

function findNextMeaningfulOptionEntries(lines, startIndex, limit = 1) {
  const result = [];

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = sanitizeText(lines[index]);
    if (!line || shouldIgnoreLine(line) || isLikelyTopicHeading(line)) {
      continue;
    }

    result.push({
      index,
      line,
    });

    if (result.length >= limit) {
      break;
    }
  }

  return result;
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
    .filter((line) => !shouldIgnoreLine(line, { allowNumeric: true }))
    .filter((line) => !/^+$/u.test(line))
    .filter((line) => !/^[\s]+[A-ZА-ЯІЇЄҐ._-]{10,}/u.test(line))
    .filter((line) => !/^[A-ZА-ЯІЇЄҐ._-]{10,}$/.test(line))
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

    if (shouldIgnoreLine(line, { allowNumeric: true })) {
      continue;
    }

    if (normalized.at(-1) === line) {
      continue;
    }

    normalized.push(line);
  }

  const merged = mergeWrappedOptionLines(normalized, optionCount);

  if (!isAutoOptionCount(optionCount) && merged.length > optionCount) {
    const repartitioned = repartitionOverflowOptionLines(normalized, optionCount);
    if (repartitioned) {
      return repartitioned;
    }

    return merged.slice(0, optionCount);
  }

  return merged;
}

function mergeWrappedOptionLines(lines, optionCount) {
  const entries = Array.isArray(lines) ? lines.filter(Boolean) : [];
  const expectedOptionCount = Number(optionCount);
  if (!Number.isInteger(expectedOptionCount) || expectedOptionCount < 2 || entries.length <= expectedOptionCount) {
    return entries;
  }

  const merged = [];

  for (let index = 0; index < entries.length; index += 1) {
    const line = sanitizeText(entries[index]);
    if (!line) {
      continue;
    }

    if (!merged.length) {
      merged.push(line);
      continue;
    }

    const previous = merged.at(-1);
    const remainingRawIncludingCurrent = entries.length - index;
    const remainingSlots = Math.max(1, expectedOptionCount - merged.length);
    const shouldMerge = shouldContinueOptionText(previous, line)
      || (
        remainingRawIncludingCurrent > remainingSlots
        && looksLikeOverflowOptionContinuation(previous, line)
      )
      || (
        remainingRawIncludingCurrent > remainingSlots
        && /^[\p{Ll}\p{Lo}\d(]/u.test(line)
      );

    if (shouldMerge) {
      merged[merged.length - 1] = joinFragments(previous, line);
      continue;
    }

    merged.push(line);
  }

  return merged;
}

function repartitionOverflowOptionLines(lines, optionCount) {
  const expectedOptionCount = Number(optionCount);
  const entries = Array.isArray(lines)
    ? lines.map((line) => sanitizeText(line)).filter(Boolean).map((line) => ({ line }))
    : [];
  if (!Number.isInteger(expectedOptionCount) || expectedOptionCount < 2 || entries.length <= expectedOptionCount) {
    return null;
  }

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
      if (!isValidOverflowOptionChunk(chunk)) {
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

  return solve(0, expectedOptionCount);
}

function isValidOverflowOptionChunk(chunk) {
  if (!Array.isArray(chunk) || !chunk.length) {
    return false;
  }

  if (chunk.length === 1) {
    return looksLikeStandaloneOptionLine(chunk[0]);
  }

  for (let index = 1; index < chunk.length; index += 1) {
    if (!shouldContinueOptionText(chunk[index - 1], chunk[index]) && !looksLikeOverflowOptionContinuation(chunk[index - 1], chunk[index])) {
      return false;
    }
  }

  return true;
}

function looksLikeOverflowOptionContinuation(currentOption, nextLine) {
  const current = sanitizeText(currentOption);
  const next = sanitizeText(nextLine);
  if (!current || !next) {
    return false;
  }

  if (/[.?!:;]$/.test(current)) {
    return false;
  }

  if (looksLikeQuestionTail(current) && looksLikePromptSentence(current)) {
    return false;
  }

  const currentWords = current.split(/\s+/).filter(Boolean).length;
  const nextWords = next.split(/\s+/).filter(Boolean).length;
  if (
    currentWords === 1
    && current.length <= 20
    && nextWords >= 2
    && /^[\p{Lu}\p{Lt}\p{Lo}"«(]/u.test(next)
  ) {
    return true;
  }

  if (
    currentWords <= 2
    && current.length <= 26
    && /^(України|МОЗ|Міністерства|ДСанПіН|ДСТУ|ДБН|Санітарний|Державні)\b/u.test(next)
  ) {
    return true;
  }

  return false;
}

function looksLikeRealQuestion(questionText, options) {
  const normalizedQuestion = sanitizeText(questionText);
  if (!normalizedQuestion) {
    return false;
  }

  if (/[?:]$/.test(normalizedQuestion) && normalizedQuestion.length >= 8) {
    return true;
  }

  if (normalizedQuestion.length < 20) {
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
  return sanitizeText(
    sanitizeText(trimmedLines.join(' '))
      .replace(/^ЗМ\s*\d+(?:\s*-\s*\d+)?\.?\s*/iu, '')
      .replace(/([-\u2013\u2014])\s+(\d)/gu, '$1$2'),
  );
}

function backfillQuestionLeadIn(lines, startIndex, questionText) {
  let text = sanitizeText(questionText);
  if (!text || !Array.isArray(lines) || startIndex <= 0) {
    return text;
  }

  const shouldBackfill = /^[\p{Ll}\p{Lo}]/u.test(text) || text.length < 80;
  if (!shouldBackfill) {
    return text;
  }

  for (let index = startIndex - 1; index >= Math.max(0, startIndex - 3); index -= 1) {
    const candidateLine = sanitizeText(lines[index]);
    if (!candidateLine || shouldIgnoreLine(candidateLine) || isLikelyTopicHeading(candidateLine) || isLikelyStandaloneMetaHeading(candidateLine)) {
      continue;
    }

    if (looksLikeProbableAnswerLine(candidateLine)) {
      break;
    }

    text = buildQuestionText([candidateLine, text]);
    if (text.length >= 100 && !/^[\p{Ll}\p{Lo}]/u.test(text)) {
      break;
    }
  }

  return text;
}

function looksLikeProbableAnswerLine(line) {
  const text = sanitizeText(line);
  if (!text) {
    return false;
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return looksLikeStandaloneOptionLine(text)
    && wordCount <= 6
    && text.length <= 60
    && !/[,\-–—]$/.test(text);
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
    const questionText = backfillQuestionLeadIn(lines, index, buildQuestionText(chunk));
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
  const minOptionCount = minimumAllowedOptionCount(optionCount);

  for (let index = 0; index <= lines.length - minOptionCount - 1; index += 1) {
    if (!looksLikeQuestionTail(lines[index])) {
      continue;
    }

    if (lines.length - (index + 1) >= minOptionCount) {
      bestIndex = index;
    }
  }

  if (bestIndex >= 0) {
    return bestIndex;
  }

  if (lines.length >= minOptionCount + 1) {
    return lines.length - minOptionCount - 1;
  }

  return -1;
}

function looksLikeQuestionTail(line) {
  const text = sanitizeText(line);
  if (!text) {
    return false;
  }

  if (/[?:]$/.test(text)) {
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

  if (!questionText || !isAcceptableOptionCount(options.length, optionCount)) {
    return false;
  }

  target.push({
    q: questionText,
    options,
    correctIndex: resolveQuestionCorrectIndex(answerIndex, options.length),
  });

  return true;
}

function cleanupLine(line) {
  return String(line || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}

function shouldIgnoreLine(line, { allowNumeric = false } = {}) {
  if (!line) {
    return true;
  }

  if (/^Всього питань:\s*\d+\s*$/i.test(line)) {
    return true;
  }

  if (/[\uE000-\uF8FF]/u.test(line) || PRIVATE_USE_SYMBOLS.test(line)) {
    return true;
  }

  if (!allowNumeric && /^\d+$/.test(line)) {
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

  if (/^[\uE000-\uF8FF\s]+\S+/u.test(line)) {
    return true;
  }

  if (/^https?:\/\/\S+/i.test(line)) {
    return true;
  }

  if (/^\S+\s+https?:\/\/\S+/i.test(line)) {
    return true;
  }

  if (/^\s*\u0421\u0442\u043e\u0440\u0456\u043d(?:\u043a|\u0138)\u0430\s+\d+\s+\u0456\u0437\s+\d+\s*$/iu.test(line)) {
    return true;
  }

  const compactAscii = line.replace(/[^\p{L}\p{N}._-]+/gu, '');
  if (compactAscii && compactAscii.length >= 12 && /^[A-Z0-9._-]{12,}$/.test(compactAscii)) {
    return true;
  }

  return false;
}

function isLikelyTopicHeadingLegacy(line) {
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

function isLikelyTopicHeading(line) {
  if (!line) {
    return false;
  }

  if (matchesNormalizedModuleHeading(line)) {
    return true;
  }

  if (/^Ð·Ð¼Ñ–ÑÑ‚Ð¾Ð²Ð¸Ð¹ Ð¼Ð¾Ð´ÑƒÐ»ÑŒ$/i.test(line)) {
    return true;
  }

  if (/^[A-ZÐ-Ð¯Ð†Ð‡Ð„Ò0-9\s.,()/-]{8,}$/u.test(line) && !/[?:]$/.test(line)) {
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
  const text = sanitizeText(line);
  if (!text) {
    return false;
  }

  if (!/^[a-zа-яіїєґ]/u.test(text) || looksLikeQuestionTail(text)) {
    return false;
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return wordCount <= 5
    && text.length <= 40
    && !/[.,;]$/.test(text);
}

function looksLikePromptSentence(text) {
  return /(який|яка|яке|які|що|хто|де|коли|чому|скільки|виберіть|вкажіть|укажіть|назвіть|опишіть|визначити|визначте|оберіть|обрати|до якої|для якого|з якими|про збудника якої|яке можливе|який метод|яку інфекцію)/i.test(String(text || ''));
}

function looksLikeQuestionParagraph(line) {
  const text = sanitizeText(line);
  if (!text) {
    return false;
  }

  if (matchQuestionStart(text) || matchStandaloneQuestionStart(text)) {
    return true;
  }

  if (!looksLikeQuestionTail(text)) {
    return false;
  }

  if (/[?:]$/.test(text)) {
    return true;
  }

  if (/\.$/.test(text) && text.split(/\s+/).filter(Boolean).length <= 8) {
    return false;
  }

  return text.length >= 40 || looksLikePromptSentence(text);
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
  const standaloneMatch = matchStandaloneQuestionStart(line);
  if (standaloneMatch) {
    return {
      number: standaloneMatch.number,
      text: '',
    };
  }

  const inlineMatch = matchStrictInlineQuestionStart(line);
  if (!inlineMatch) {
    return null;
  }

  return {
    number: inlineMatch.number,
    text: inlineMatch.text,
  };
}

function matchStandaloneQuestionStart(line) {
  const match = line.match(/^(\d{1,3})\s*[\.\):]?$/);
  if (!match) {
    return null;
  }

  return {
    number: Number(match[1]),
  };
}

function matchStrictInlineQuestionStart(line) {
  const match = line.match(/^(\d{1,3})\s*([.):])\s*(.+)$/);
  if (!match) {
    return null;
  }

  const number = Number(match[1]);
  const text = sanitizeText(match[3]);
  if (!Number.isInteger(number) || number < 1 || number > 999 || !text || /^\d/.test(text)) {
    return null;
  }

  return {
    number,
    text,
  };
}

function findNextMeaningfulRawLine(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = cleanupLine(lines[index]);
    if (!line || shouldIgnoreLine(line)) {
      continue;
    }
    return line;
  }

  return '';
}

function findPreviousMeaningfulRawLine(lines, startIndex) {
  for (let index = startIndex; index >= 0; index -= 1) {
    const line = cleanupLine(lines[index]);
    if (!line || shouldIgnoreLine(line)) {
      continue;
    }
    return line;
  }

  return '';
}

function looksLikeRawNumericOptionLine(line, current, nextLine) {
  const value = sanitizeText(line);
  if (!value || !current) {
    return false;
  }

  if (!/^\d{1,3}$/.test(value)) {
    return false;
  }

  if ((current.lines?.length || 0) < 2) {
    return false;
  }

  if (!nextLine) {
    return true;
  }

  return /^\d/.test(nextLine);
}

function looksLikeNumericOptionInlineStart(match) {
  return Boolean(match?.text) && /^\d/.test(match.text);
}

function matchOptionStart(line, optionCount) {
  const markerCount = maximumAllowedOptionCount(optionCount);
  const markers = [
    ...LATIN_MARKERS.slice(0, markerCount),
    ...LATIN_MARKERS.slice(0, markerCount).map((item) => item.toLowerCase()),
    ...CYRILLIC_MARKERS.slice(0, markerCount),
    ...CYRILLIC_MARKERS.slice(0, markerCount).map((item) => item.toLowerCase()),
    ...Array.from({ length: markerCount }, (_, index) => String(index + 1)),
  ];

  const escapedMarkers = markers
    .sort((a, b) => b.length - a.length)
    .map((marker) => marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  const separatorPattern = '(?:\\)|\\.|-|\\u2013|\\u2014|:)';
  const regex = new RegExp(`^(${escapedMarkers})(\\s*${separatorPattern})(\\s*)(.+)$`, 'u');
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
  const markerIsNumeric = /^\d+$/.test(marker);
  const textStartsLowercase = /^\p{Ll}/u.test(text);
  const textStartsUppercaseOrDigit = /^[\p{Lu}\d]/u.test(text);

  if (markerIsNumeric && /^\d/.test(text)) {
    return null;
  }

  // Prevent false positives like "В-рус ..." where the first letter is part of the word,
  // not an answer marker extracted from the source file.
  if (markerIsLetter && !spacing && textStartsLowercase) {
    return null;
  }

  // Prevent false positives like "C.D 4" / "CD 4" OCR splits where the leading
  // single-letter "marker" is actually part of an abbreviation in the option text.
  if (markerIsLetter && !spacing && textStartsUppercaseOrDigit) {
    return null;
  }

  // Prevent false positives like "E. coli" where the leading letter belongs
  // to the biological name and is not an answer marker.
  if (markerIsLetter && spacing && match[2]?.includes('.') && textStartsLowercase) {
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
    if (/^\d/.test(b)) {
      return `${a}${b}`;
    }
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

export const __debug__ = { parseQuestionsFromQuestionTails, splitIntoLines, extractTextFromFile, normalizeExtractedText, tryBuildWrappedQuestion, collectSequentialOptions };
