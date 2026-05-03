import { sanitizeText } from './utils.js';

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const EXPLANATION_LOG_PREFIX = '[explanations]';

export function isGeminiExplanationAvailable() {
  return Boolean(String(process.env.GEMINI_API_KEY || '').trim());
}

export async function createGeminiExplanation({
  quizTitle = '',
  questionNumber,
  question,
  selectedOptionNumber = null,
}) {
  if (String(process.env.USE_MOCK_AI || '0') === '1') {
    logExplanation('using mock explanation', {
      questionNumber,
      selectedOptionNumber,
    });
    return buildMockExplanation(question);
  }

  const normalizedQuestionNumber = Number(questionNumber);
  if (!Number.isInteger(normalizedQuestionNumber) || normalizedQuestionNumber < 1) {
    const error = new Error('Invalid question number.');
    error.statusCode = 400;
    throw error;
  }

  if (!question || !Array.isArray(question.options) || !question.options.length) {
    const error = new Error('Question payload is incomplete.');
    error.statusCode = 400;
    throw error;
  }

  const correctOptionIndex = Number(question.correctIndex);
  if (!Number.isInteger(correctOptionIndex) || correctOptionIndex < 0 || correctOptionIndex >= question.options.length) {
    const error = new Error('Question does not have a valid correct answer.');
    error.statusCode = 422;
    throw error;
  }

  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error('Пояснення від ШІ тимчасово недоступне.');
    error.statusCode = 503;
    throw error;
  }

  const model = String(process.env.GEMINI_MODEL || 'gemini-2.0-flash').trim();
  const prompt = buildExplanationPrompt({
    quizTitle,
    questionNumber: normalizedQuestionNumber,
    question,
  });

  logExplanation('create start', {
    questionNumber: normalizedQuestionNumber,
    selectedOptionNumber,
    model,
  });

  const explanation = await requestGeminiExplanation({
    apiKey,
    model,
    prompt,
  });

  if (isExplanationTooShortOrIncomplete(explanation)) {
    logExplanation('gemini response rejected as too weak', {
      questionNumber: normalizedQuestionNumber,
      preview: previewText(explanation),
      length: explanation.length,
    });
    const error = new Error('ШІ повернув надто коротке пояснення. Спробуйте ще раз.');
    error.statusCode = 502;
    throw error;
  }

  logExplanation('gemini success', {
    questionNumber: normalizedQuestionNumber,
    preview: previewText(explanation),
    length: explanation.length,
  });
  return explanation;
}

async function requestGeminiExplanation({
  apiKey,
  model,
  prompt,
}) {
  const response = await fetch(
    `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: buildSystemInstruction(),
            },
          ],
        },
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          topP: 0.85,
          maxOutputTokens: 500,
        },
      }),
    },
  );

  const payload = await response.json().catch(() => ({}));
  logExplanation('gemini http response', {
    status: response.status,
    ok: response.ok,
    finishReason: payload?.candidates?.[0]?.finishReason || null,
    promptBlocked: payload?.promptFeedback?.blockReason || null,
  });

  if (!response.ok) {
    const error = new Error(extractGeminiErrorMessage(payload, response.status));
    error.statusCode = 502;
    throw error;
  }

  const explanation = sanitizeExplanation(extractGeminiText(payload));
  if (!explanation) {
    const error = new Error('Не вдалося отримати пояснення від ШІ.');
    error.statusCode = 502;
    throw error;
  }

  return explanation;
}

function buildSystemInstruction() {
  return [
    'You explain medical multiple-choice test answers in Ukrainian.',
    'Follow the exact output structure below.',
    'First line: one short sentence naming the correct answer.',
    'Then a blank line.',
    'Then "Суть:" on its own line.',
    'Then 2 short sentences with a concrete medical explanation.',
    'Then a blank line.',
    'Then "Маркер:" on its own line.',
    'Then 1 short memorable sentence or formula.',
    'Do not analyze wrong options.',
    'Do not use vague phrases.',
    'Do not repeat the full question.',
    'Use specific facts: mechanism, hormone effect, pathogen trait, anatomy, pathophysiology, or clinical sign.',
    'Make the answer easy to remember.',
  ].join(' ');
}

function buildExplanationPrompt({
  quizTitle,
  questionNumber,
  question,
}) {
  const correctAnswer = sanitizeText(question.options[Number(question.correctIndex)] || '');

  return [
    `Quiz: ${sanitizeText(quizTitle || 'Quiz')}`,
    `Question ${questionNumber}: ${sanitizeText(question.q)}`,
    `Correct answer: ${correctAnswer}`,
    '',
    'Write the answer exactly in this format:',
    `${correctAnswer} ...`,
    '',
    'Суть:',
    '2 short medically specific sentences.',
    '',
    'Маркер:',
    '1 short memorable sentence.',
    '',
    'The explanation must say why the correct answer is right in medical terms.',
    'Do not discuss why other answers are wrong.',
  ].join('\n');
}

function extractGeminiText(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const text = parts
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
    if (text) {
      return text;
    }
  }
  return '';
}

function sanitizeExplanation(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\*+/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isExplanationTooShortOrIncomplete(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return true;
  }

  if (!normalized.includes('Суть:') || !normalized.includes('Маркер:')) {
    return true;
  }

  if (normalized.length < 80) {
    return true;
  }

  return false;
}

function extractGeminiErrorMessage(payload, statusCode) {
  const rawMessage = sanitizeText(payload?.error?.message || payload?.promptFeedback?.blockReason || '');
  const normalized = rawMessage.toLowerCase();
  const retrySeconds = extractRetrySeconds(rawMessage);

  if (normalized.includes('quota exceeded') || normalized.includes('rate limit') || normalized.includes('resource exhausted')) {
    if (retrySeconds != null) {
      return `Ліміт ШІ тимчасово вичерпано. Спробуйте ще раз приблизно через ${retrySeconds} с.`;
    }
    return 'Ліміт ШІ тимчасово вичерпано. Спробуйте ще раз трохи пізніше.';
  }

  if (statusCode === 429) {
    if (retrySeconds != null) {
      return `Забагато запитів до ШІ. Спробуйте ще раз приблизно через ${retrySeconds} с.`;
    }
    return 'Забагато запитів до ШІ. Спробуйте ще раз трохи пізніше.';
  }

  if (rawMessage) {
    return rawMessage;
  }

  return 'Не вдалося отримати пояснення від ШІ.';
}

function extractRetrySeconds(message) {
  const match = String(message || '').match(/retry in\s+([0-9]+(?:\.[0-9]+)?)s/i);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.max(1, Math.ceil(value));
}

function previewText(value, maxLength = 160) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized;
}

function buildMockExplanation(question) {
  const correctAnswer = sanitizeText(question?.options?.[Number(question?.correctIndex)] || 'правильна відповідь');
  return [
    `${correctAnswer} є правильною відповіддю.`,
    '',
    'Суть:',
    'Саме цей варіант відповідає ключовому медичному механізму або ознаці, яку перевіряє завдання. Правильність визначається конкретним фізіологічним, патологічним або фармакологічним змістом.',
    '',
    'Маркер:',
    `${correctAnswer} = ключовий механізм або ознака з умови.`,
  ].join('\n');
}

function logExplanation(message, details = null) {
  if (details && Object.keys(details).length > 0) {
    console.log(EXPLANATION_LOG_PREFIX, message, details);
    return;
  }
  console.log(EXPLANATION_LOG_PREFIX, message);
}
