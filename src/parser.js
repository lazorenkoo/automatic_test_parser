import path from 'node:path';
import { createRequire } from 'node:module';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { normalizeUploadedFilename, sanitizeText } from './utils.js';

const require = createRequire(import.meta.url);
const WordExtractor = require('word-extractor');

const extractor = new WordExtractor();

export const SUPPORTED_UPLOAD_EXTENSIONS = ['.pdf', '.doc', '.docx'];

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
}) {
  const effectiveLimit = normalizeQuestionLimit(limit);
  const extension = path.extname(filename || '').toLowerCase();
  const extractedText = await extractTextFromFile(buffer, extension);
  const normalizedText = normalizeExtractedText(extractedText);

  if (!normalizedText) {
    throw new Error('Не удалось извлечь текст из файла.');
  }

  const lines = splitIntoLines(normalizedText);
  const paragraphs = splitIntoParagraphs(normalizedText);

  const candidates = [
    parseQuestionsFromText(lines, { answerIndex, limit: effectiveLimit, optionCount }),
    parseQuestionsFromLineBlocks(lines, { answerIndex, limit: effectiveLimit, optionCount }),
    parseQuestionsFromParagraphs(paragraphs, { answerIndex, limit: effectiveLimit, optionCount }),
    parseQuestionsByStride(paragraphs, { answerIndex, limit: effectiveLimit, optionCount }),
  ];

  const parsed = chooseBestParsedResult(candidates);
  if (!parsed.questions.length) {
    throw new Error(`Не удалось распарсить вопросы. Попробуйте другое количество вариантов ответа: сейчас выбрано ${optionCount}.`);
  }

  return {
    title: buildTitleFromFilename(filename),
    questions: parsed.questions,
    rawModelJson: {
      parser: parsed.parser,
      optionCount,
      extractedCharacters: normalizedText.length,
      acceptedQuestions: parsed.questions.length,
      droppedBlocks: parsed.droppedBlocks,
    },
    notes: parsed.notes,
  };
}

async function extractTextFromFile(buffer, extension) {
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
    droppedBlocks,
    qualityScore: questions.length * 10 - droppedBlocks,
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
  let droppedBlocks = 0;

  for (const block of blocks) {
    const parsedBlock = parseLineBlock(block.lines, optionCount);
    if (!parsedBlock) {
      droppedBlocks += 1;
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
    droppedBlocks,
    qualityScore: questions.length * 12 - droppedBlocks,
  };
}

function parseQuestionsFromParagraphs(textInput, { answerIndex, limit, optionCount }) {
  const paragraphs = Array.isArray(textInput) ? textInput : splitIntoParagraphs(textInput);
  const questions = [];
  const notes = [];
  let droppedBlocks = 0;

  for (let index = 0; index < paragraphs.length; index += 1) {
    const current = paragraphs[index];

    if (!looksLikeQuestionParagraph(current)) {
      continue;
    }

    const options = paragraphs.slice(index + 1, index + 1 + optionCount);
    if (options.length < optionCount) {
      droppedBlocks += 1;
      break;
    }

    const cleanOptions = options.map((option) => sanitizeText(option)).filter(Boolean);
    if (cleanOptions.length !== optionCount || cleanOptions.some(looksLikeQuestionParagraph)) {
      droppedBlocks += 1;
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
    droppedBlocks,
    qualityScore: questions.length * 8 - droppedBlocks,
  };
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
  const cleanLines = dedupeAdjacentLines(lines
    .map((line) => sanitizeText(line))
    .filter(Boolean));

  if (cleanLines.length < optionCount + 1) {
    return null;
  }

  const splitIndex = findQuestionOptionBoundary(cleanLines, optionCount);
  if (splitIndex < 0) {
    return null;
  }

  const questionText = sanitizeText(cleanLines.slice(0, splitIndex + 1).join(' '));
  const optionLines = cleanLines.slice(splitIndex + 1);
  const options = optionLines.slice(0, optionCount).map((line) => sanitizeText(line)).filter(Boolean);

  if (!questionText || options.length !== optionCount) {
    return null;
  }

  return {
    q: questionText,
    options,
  };
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
  return /[?:]$/.test(line);
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

  if (PRIVATE_USE_SYMBOLS.test(line)) {
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
  if (compactAscii && /^[A-Z0-9._-]{4,}$/.test(compactAscii)) {
    return true;
  }

  return false;
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

  const regex = new RegExp(`^(?:${escapedMarkers})\\s*[\\)\\.\\-${DASH_CHARS}:]\\s*(.+)$`);
  const match = line.match(regex);
  if (!match) {
    return null;
  }

  return {
    text: sanitizeText(match[1]),
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
    droppedBlocks: 0,
    qualityScore: 0,
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
  if (!Number.isFinite(limit)) {
    return [];
  }

  if (foundCount >= limit) {
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
