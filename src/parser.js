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

export async function parseQuizFromFile({
  buffer,
  filename,
  answerIndex,
  limit,
  optionCount,
}) {
  const extension = path.extname(filename || '').toLowerCase();
  const extractedText = await extractTextFromFile(buffer, extension);
  const normalizedText = normalizeExtractedText(extractedText);
  const paragraphs = splitIntoParagraphs(normalizedText);

  if (!normalizedText) {
    throw new Error('Не удалось извлечь текст из файла.');
  }

  let parsed = parseQuestionsFromText(normalizedText, {
    answerIndex,
    limit,
    optionCount,
  });

  if (!parsed.questions.length) {
    parsed = parseQuestionsFromParagraphs(paragraphs, {
      answerIndex,
      limit,
      optionCount,
    });
  }

  const strideParsed = parseQuestionsByStride(paragraphs, {
    answerIndex,
    limit,
    optionCount,
  });

  if (strideParsed.questions.length > parsed.questions.length) {
    parsed = strideParsed;
  }

  if (!parsed.questions.length) {
    throw new Error(`Не удалось распарсить вопросы. Попробуйте другое количество вариантов ответа: сейчас выбрано ${optionCount}.`);
  }

  return {
    title: buildTitleFromFilename(filename),
    questions: parsed.questions,
    rawModelJson: {
      parser: 'local-v1',
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

function parseQuestionsFromText(text, { answerIndex, limit, optionCount }) {
  const lines = text
    .split('\n')
    .map((line) => cleanupLine(line))
    .filter((line) => !shouldIgnoreLine(line));

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

  if (questions.length < limit) {
    notes.push(`Найдено вопросов: ${questions.length}. Запрошено: ${limit}.`);
  }

  return {
    questions: questions.slice(0, limit),
    notes,
    droppedBlocks,
  };
}

function parseQuestionsFromParagraphs(text, { answerIndex, limit, optionCount }) {
  const paragraphs = Array.isArray(text) ? text : splitIntoParagraphs(text);
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

  if (questions.length < limit) {
    notes.push(`Найдено вопросов: ${questions.length}. Запрошено: ${limit}.`);
  }

  return {
    questions,
    notes,
    droppedBlocks,
  };
}

function parseQuestionsByStride(paragraphsInput, { answerIndex, limit, optionCount }) {
  const paragraphs = Array.isArray(paragraphsInput) ? paragraphsInput : splitIntoParagraphs(paragraphsInput);
  const blockSize = optionCount + 1;

  if (paragraphs.length < blockSize) {
    return { questions: [], notes: [], droppedBlocks: 0 };
  }

  let best = { questions: [], notes: [], droppedBlocks: 0, score: -1, offset: 0 };

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
      best = {
        questions,
        notes: [],
        droppedBlocks: 0,
        score,
        offset,
      };
    }
  }

  const notes = [];
  if (best.questions.length && best.offset > 0) {
    notes.push(`Пропущено служебных абзацев в начале: ${best.offset}.`);
  }

  if (best.questions.length < limit) {
    notes.push(`Найдено вопросов: ${best.questions.length}. Запрошено: ${limit}.`);
  }

  return {
    questions: best.questions,
    notes,
    droppedBlocks: 0,
  };
}

function createQuestionState(initialText) {
  return {
    q: initialText,
    options: [],
  };
}

function pushCompletedQuestion(target, current, answerIndex, optionCount) {
  const questionText = sanitizeText(current.q);
  const options = current.options
    .map((option) => sanitizeText(option))
    .filter(Boolean);

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

function splitIntoParagraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((part) => cleanupLine(part))
    .filter((part) => !shouldIgnoreLine(part));
}

function shouldIgnoreLine(line) {
  if (!line) {
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

  return false;
}

function looksLikeQuestionParagraph(line) {
  if (!line) {
    return false;
  }

  if (matchQuestionStart(line)) {
    return true;
  }

  if (line.endsWith(':') || line.endsWith('?')) {
    return true;
  }

  return false;
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

  const regex = new RegExp(`^(?:${escapedMarkers})\\s*[\\)\\.\\-–—:]\\s*(.+)$`);
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

  if (/[—-]$/.test(a)) {
    return `${a.slice(0, -1)}${b}`;
  }

  return `${a} ${b}`;
}

function buildTitleFromFilename(filename) {
  return normalizeUploadedFilename(filename)
    .replace(/\.[^.]+$/u, '')
    .replace(/[_-]+/g, ' ')
    .trim() || 'Medical quiz';
}
