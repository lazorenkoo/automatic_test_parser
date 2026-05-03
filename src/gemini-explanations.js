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

  const fallbackExplanation = buildFallbackExplanation({ question });

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
  } catch (error) {
    logExplanation('fallback: local ai slot rejected', {
      questionNumber: normalizedQuestionNumber,
      reason: error?.message || 'unknown',
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
  } catch (error) {
    logExplanation('fallback: gemini request failed', {
      questionNumber: normalizedQuestionNumber,
      reason: error?.message || 'unknown',
    });
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
          temperature: 0.15,
          topP: 0.9,
          maxOutputTokens: 450,
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

function previewText(value, maxLength = 160) {
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
    'Write a concise but medically meaningful explanation, not a superficial restatement.',
    'Focus only on why the correct option is right.',
    'Do not explain why the wrong option is wrong.',
    'Explain the medical basis of the correct answer: mechanism, pathophysiology, anatomy, pharmacology, physiology, diagnosis, microbiology, or clinical sign as appropriate.',
    'Do not mention being an AI model.',
    'Do not add warnings or generic disclaimers.',
    'Write 2 or 3 complete sentences in Ukrainian.',
    'Do not write fragments, headings, bullets, or one-line stubs.',
    'Do not restate the full question because it will be shown separately in the UI.',
    'Do not start with "Правильна відповідь" because the UI will show it separately.',
    'Start immediately with the factual medical explanation.',
    'Use concrete medical facts rather than generic phrases.',
    'Name the exact mechanism, pathogen, anatomical structure, laboratory change, drug effect, disease process, or clinical sign that makes the answer correct.',
    'If relevant, explain how that mechanism leads to the symptom, diagnosis, finding, or treatment effect described in the question.',
    'Make the explanation easy to remember.',
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
    `Correct answer: ${sanitizeText(question.options[Number(question.correctIndex)] || '')}`,
    'Options:',
    ...optionLines,
    '',
    'Explain in Ukrainian why the correct answer is medically correct.',
    'Do not discuss why the chosen wrong answer is wrong.',
    'Do not restate the full question because it will be shown above the explanation in the UI.',
    'Do not begin with "Правильна відповідь".',
    'Start directly with the medical explanation.',
    'Give a real medical explanation with the key mechanism, feature, definition, anatomical basis, physiological process, pathological process, microbiological basis, or pharmacological action.',
    'Use concrete facts, not generic wording.',
    'Make it easy to remember in 2 or 3 sentences.',
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
  return sanitizeText(value)
    .replace(/\*+/g, '')
    .replace(/^Правильна відповідь\s*[—-]\s*[^.?!]+[.?!:]\s*/iu, '')
    .replace(/^У\s+(?:завданні|запитанні)\s+йдеться\s+про\s+(?:таке:)?\s*/iu, '')
    .trim();
}

function isExplanationTooShortOrIncomplete(value) {
  const normalized = sanitizeText(value);
  if (!normalized) {
    return true;
  }

  if (normalized.length < 40) {
    return true;
  }

  if (!/[.!?…]$/.test(normalized) && normalized.length < 80) {
    return true;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 8) {
    return true;
  }

  return false;
}

function buildFallbackExplanation({ question }) {
  const correctOptionIndex = Number(question?.correctIndex);
  const correctAnswer = Array.isArray(question?.options)
    ? sanitizeText(question.options[correctOptionIndex] || '')
    : '';

  if (correctAnswer) {
    return `цей варіант є правильним, бо саме він відповідає ключовому медичному критерію, який потрібно встановити. Його правильність визначається конкретним механізмом, клінічною ознакою, анатомічною структурою, збудником, лабораторною зміною або фармакологічною дією, що безпосередньо пов’язані з варіантом ${correctAnswer}.`;
  }

  return 'цей варіант є правильним, бо він відповідає конкретному медичному механізму або визначальній клінічній ознаці, яку потрібно встановити.';
}

function buildMockExplanation({ question, selectedOptionNumber }) {
  const correctOptionNumber = Number(question?.correctIndex) + 1;
  if (Number(selectedOptionNumber) === correctOptionNumber) {
    return 'саме цей варіант збігається з основною медичною ознакою або механізмом, який перевіряє завдання. Його правильність визначається конкретним патофізіологічним, анатомічним, мікробіологічним або фармакологічним змістом.';
  }

  return 'саме цей варіант відповідає ключовому медичному змісту завдання. Його правильність треба пояснювати через конкретний механізм, ознаку або процес, а не через загальні слова.';
}
