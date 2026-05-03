import { reserveAiRequestSlot } from './db.js';
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
  requestContext = null,
}) {
  if (String(process.env.USE_MOCK_AI || '0') === '1') {
    logExplanation('using mock explanation', {
      questionNumber,
      selectedOptionNumber,
    });
    return buildMockExplanation({ question, selectedOptionNumber });
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

  const fallbackExplanation = buildFallbackExplanation({
    question,
    selectedOptionNumber,
  });

  logExplanation('create start', {
    questionNumber: normalizedQuestionNumber,
    selectedOptionNumber,
    hasApiKey: Boolean(String(process.env.GEMINI_API_KEY || '').trim()),
    model: String(process.env.GEMINI_MODEL || 'gemini-2.0-flash').trim(),
  });

  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    logExplanation('fallback: missing api key', {
      questionNumber: normalizedQuestionNumber,
    });
    return fallbackExplanation;
  }

  const model = String(process.env.GEMINI_MODEL || 'gemini-2.0-flash').trim();
  const prompt = buildExplanationPrompt({
    quizTitle,
    questionNumber: normalizedQuestionNumber,
    question,
    selectedOptionNumber,
  });

  try {
    reserveAiRequestSlot({
      requestKind: 'explanation',
      model,
      title: quizTitle || null,
      sourceFilename: requestContext?.sourceFilename || null,
      browserId: requestContext?.browserId || null,
      fingerprint: requestContext?.fingerprint || null,
      requestIp: requestContext?.requestIp || null,
      requestUserAgent: requestContext?.requestUserAgent || null,
    });
  } catch (_error) {
    logExplanation('fallback: local ai slot rejected', {
      questionNumber: normalizedQuestionNumber,
      reason: _error?.message || 'unknown',
    });
    return fallbackExplanation;
  }

  try {
    const explanation = await requestGeminiExplanation({
      apiKey,
      model,
      prompt,
    });

    if (!isExplanationTooShortOrIncomplete(explanation)) {
      logExplanation('gemini success', {
        questionNumber: normalizedQuestionNumber,
        preview: previewText(explanation),
        length: explanation.length,
      });
      return explanation;
    }
    logExplanation('fallback: gemini response too short', {
      questionNumber: normalizedQuestionNumber,
      preview: previewText(explanation),
      length: explanation.length,
    });
  } catch (_error) {
    logExplanation('fallback: gemini request failed', {
      questionNumber: normalizedQuestionNumber,
      reason: _error?.message || 'unknown',
    });
    // Fall back to a local explanation when Gemini is unavailable,
    // rate-limited, quota-limited, or returns malformed content.
  }

  logExplanation('returning fallback explanation', {
    questionNumber: normalizedQuestionNumber,
    preview: previewText(fallbackExplanation),
    length: fallbackExplanation.length,
  });
  return fallbackExplanation;
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
          temperature: 0.2,
          topP: 0.9,
          maxOutputTokens: 220,
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
    const error = new Error('Не вдалося отримати пояснення від ІІ.');
    error.statusCode = 502;
    throw error;
  }

  return explanation;
}

function logExplanation(message, details = null) {
  if (details && Object.keys(details).length > 0) {
    console.log(EXPLANATION_LOG_PREFIX, message, details);
    return;
  }
  console.log(EXPLANATION_LOG_PREFIX, message);
}

function previewText(value, maxLength = 120) {
  const normalized = sanitizeText(value).replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized;
}

function buildSystemInstruction() {
  return [
    'You explain medical multiple-choice quiz answers.',
    'Keep the explanation short, clear, and student-friendly.',
    'Focus on why the correct option is right.',
    'If the selected answer is wrong, briefly say why it is less suitable only when it helps.',
    'Do not mention being an AI model.',
    'Do not add warnings or generic disclaimers.',
    'Write exactly 2 complete sentences in Ukrainian.',
    'Do not write fragments, sentence starters, headings, bullets, or one-line stubs.',
    'Finish the thought completely.',
  ].join(' ');
}

function buildExplanationPrompt({
  quizTitle,
  questionNumber,
  question,
  selectedOptionNumber,
}) {
  const optionLines = question.options.map((option, index) => {
    const markers = [];
    if (index === Number(question.correctIndex)) {
      markers.push('correct');
    }
    if (Number.isInteger(Number(selectedOptionNumber)) && index + 1 === Number(selectedOptionNumber)) {
      markers.push('selected');
    }

    const suffix = markers.length ? ` [${markers.join(', ')}]` : '';
    return `${index + 1}. ${sanitizeText(option)}${suffix}`;
  });

  return [
    `Quiz: ${sanitizeText(quizTitle || 'Quiz')}`,
    `Question ${questionNumber}: ${sanitizeText(question.q)}`,
    'Options:',
    ...optionLines,
    '',
    'Write a very short explanation in Ukrainian.',
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

function extractGeminiErrorMessage(payload, statusCode) {
  const rawMessage = sanitizeText(payload?.error?.message || payload?.promptFeedback?.blockReason || '');
  const normalized = rawMessage.toLowerCase();
  const retrySeconds = extractRetrySeconds(rawMessage);

  if (normalized.includes('quota exceeded') || normalized.includes('rate limit') || normalized.includes('resource exhausted')) {
    if (retrySeconds != null) {
      return `Ліміт ІІ тимчасово вичерпано. Спробуйте ще раз приблизно через ${retrySeconds} с.`;
    }
    return 'Ліміт ІІ тимчасово вичерпано. Спробуйте ще раз трохи пізніше.';
  }

  if (statusCode === 429) {
    if (retrySeconds != null) {
      return `Забагато запитів до ІІ. Спробуйте ще раз приблизно через ${retrySeconds} с.`;
    }
    return 'Забагато запитів до ІІ. Спробуйте ще раз трохи пізніше.';
  }

  if (rawMessage) {
    return rawMessage;
  }

  return 'Не вдалося отримати пояснення від ІІ.';
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

function sanitizeExplanation(value) {
  const normalized = sanitizeText(value).replace(/\*+/g, '');
  return normalized.slice(0, 420);
}

function isExplanationTooShortOrIncomplete(value) {
  const normalized = sanitizeText(value);
  if (!normalized) {
    return true;
  }

  if (normalized.length < 45) {
    return true;
  }

  if (!/[.!?…]$/.test(normalized) && normalized.length < 120) {
    return true;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 6) {
    return true;
  }

  return false;
}

function buildFallbackExplanation({ question, selectedOptionNumber }) {
  const correctOptionIndex = Number(question?.correctIndex);
  const correctAnswer = Array.isArray(question?.options)
    ? sanitizeText(question.options[correctOptionIndex] || '')
    : '';
  const selectedIndex = Number(selectedOptionNumber) - 1;
  const selectedAnswer = Array.isArray(question?.options) && Number.isInteger(selectedIndex)
    ? sanitizeText(question.options[selectedIndex] || '')
    : '';

  if (selectedIndex === correctOptionIndex) {
    return correctAnswer
      ? `Правильна відповідь — ${correctAnswer}, бо саме цей варіант відповідає умові питання. Інші варіанти не описують потрібний механізм або ознаку.`
      : 'Правильна відповідь відповідає умові питання. Інші варіанти не описують потрібний механізм або ознаку.';
  }

  if (correctAnswer && selectedAnswer) {
    return `Правильна відповідь — ${correctAnswer}, бо саме цей варіант відповідає умові питання. Варіант ${selectedAnswer} не описує головний механізм або ознаку, про яку йдеться.`;
  }

  if (correctAnswer) {
    return `Правильна відповідь — ${correctAnswer}, бо саме цей варіант відповідає умові питання. Інші варіанти не є настільки точними.`;
  }

  return 'Правильна відповідь відповідає умові питання. Інші варіанти не описують потрібний механізм або ознаку.';
}

function buildMockExplanation({ question, selectedOptionNumber }) {
  const correctOptionNumber = Number(question?.correctIndex) + 1;
  if (Number(selectedOptionNumber) === correctOptionNumber) {
    return `Правильна відповідь ${correctOptionNumber}, бо саме вона найточніше відповідає змісту питання. Інші варіанти тут менш доречні.`;
  }

  return `Правильна відповідь ${correctOptionNumber}, бо саме вона відповідає ключовій ознаці в питанні. Обраний варіант не є найточнішим за змістом.`;
}
