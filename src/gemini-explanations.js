import { reserveAiRequestSlot } from './db.js';
import { sanitizeText } from './utils.js';

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

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
    return buildMockExplanation({ question, selectedOptionNumber });
  }

  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error('Пояснення від ІІ тимчасово недоступне.');
    error.statusCode = 503;
    throw error;
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

  const model = String(process.env.GEMINI_MODEL || 'gemini-2.0-flash').trim();
  const prompt = buildExplanationPrompt({
    quizTitle,
    questionNumber: normalizedQuestionNumber,
    question,
    selectedOptionNumber,
  });

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
              text: [
                'You explain medical multiple-choice quiz answers.',
                'Keep the explanation short, clear, and student-friendly.',
                'Use at most 3 short sentences.',
                'Focus on why the correct option is right.',
                'If the selected answer is wrong, briefly say why it is less suitable only when it helps.',
                'Do not mention being an AI model.',
                'Do not add warnings or generic disclaimers.',
              ].join(' '),
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
          temperature: 0.3,
          topP: 0.9,
          maxOutputTokens: 180,
        },
      }),
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(extractGeminiErrorMessage(payload) || `Gemini request failed with status ${response.status}.`);
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

function extractGeminiErrorMessage(payload) {
  return sanitizeText(payload?.error?.message || payload?.promptFeedback?.blockReason || '');
}

function sanitizeExplanation(value) {
  const normalized = sanitizeText(value).replace(/\*+/g, '');
  return normalized.slice(0, 420);
}

function buildMockExplanation({ question, selectedOptionNumber }) {
  const correctOptionNumber = Number(question?.correctIndex) + 1;
  if (Number(selectedOptionNumber) === correctOptionNumber) {
    return `Правильна відповідь ${correctOptionNumber}, бо саме вона найточніше відповідає змісту питання. Інші варіанти тут менш доречні.`;
  }

  return `Правильна відповідь ${correctOptionNumber}, бо саме вона відповідає ключовій ознаці в питанні. Обраний варіант не є найточнішим за змістом.`;
}
