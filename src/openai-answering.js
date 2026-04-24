import { reserveAiRequestSlot } from './db.js';

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';

export async function solveQuizAnswersWithAI({
  filename,
  questions,
  optionCount,
  mode = 'double',
  requestContext = null,
  onProgress = null,
}) {
  if (String(process.env.USE_MOCK_AI || '0') === '1') {
    return buildMockAiResult(questions);
  }

  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY is not configured.');
    error.statusCode = 503;
    throw error;
  }

  if (!Array.isArray(questions) || !questions.length) {
    throw new Error('No parsed questions available for AI answer solving.');
  }

  const primaryModel = String(process.env.OPENAI_PRIMARY_MODEL || 'gpt-5.4').trim();
  const checkModel = String(process.env.OPENAI_CHECK_MODEL || 'gpt-5.4-mini').trim();
  const normalizedMode = String(mode || '').trim().toLowerCase() === 'single' ? 'single' : 'double';
  const useChecker = normalizedMode === 'double';

  const compactQuestions = questions.map((question, index) => ({
    number: index + 1,
    question: question.q,
    options: question.options.map((option, optionIndex) => ({
      index: optionIndex + 1,
      text: option,
    })),
  }));
  const chunkSize = resolveChunkSize();
  const questionChunks = chunkQuestions(compactQuestions, chunkSize);
  const totalSteps = Math.max(1, questionChunks.length * (useChecker ? 2 : 1));
  const primaryAnswers = {};
  const primaryInsights = {};
  const checkAnswers = {};
  const primaryTexts = [];
  const checkTexts = [];
  let completedSteps = 0;

  reportAiProgress(onProgress, {
    stage: 'starting',
    percent: 0,
    chunkIndex: 0,
    chunkCount: questionChunks.length,
    completedSteps,
    totalSteps,
  });

  for (let chunkIndex = 0; chunkIndex < questionChunks.length; chunkIndex += 1) {
    const chunk = questionChunks[chunkIndex];
    const questionNumbers = chunk.map((item) => item.number);
    const maxAnswerIndex = chunk.reduce(
      (maxValue, item) => Math.max(maxValue, Array.isArray(item.options) ? item.options.length : 0),
      1,
    );
    const primaryPrompt = buildPrimaryPrompt({
      filename,
      optionCount,
      compactQuestions: chunk,
      chunkIndex,
      chunkCount: questionChunks.length,
    });

    const checkPrompt = buildCheckPrompt({
      compactQuestions: chunk,
      chunkIndex,
      chunkCount: questionChunks.length,
    });

    const primaryResult = await createOpenAIAnswersResponse({
      apiKey,
      model: primaryModel,
      passType: 'primary',
      detailed: true,
      requestContext,
      reasoningEffort: resolveReasoningEffort('primary'),
      prompt: primaryPrompt,
      expectedQuestionNumbers: questionNumbers,
      maxAnswerIndex,
      maxOutputTokens: resolveInitialMaxOutputTokens(chunk.length, 'primary'),
    });
    const primaryChunkAnswers = extractAnswerIndexMap(primaryResult.answers);
    completedSteps += 1;
    reportAiProgress(onProgress, {
      stage: 'primary-complete',
      percent: Math.round((completedSteps / totalSteps) * 100),
      chunkIndex: chunkIndex + 1,
      chunkCount: questionChunks.length,
      completedSteps,
      totalSteps,
    });

    Object.assign(primaryAnswers, primaryChunkAnswers);
    Object.assign(primaryInsights, buildPrimaryInsightsMap(primaryResult.answers));
    primaryTexts.push(primaryResult.rawText);

    if (useChecker) {
      const checkResult = await createOpenAIAnswersResponse({
        apiKey,
        model: checkModel,
        passType: 'check',
        detailed: false,
        requestContext,
        reasoningEffort: resolveReasoningEffort('check'),
        prompt: checkPrompt,
        expectedQuestionNumbers: questionNumbers,
        maxAnswerIndex,
        maxOutputTokens: resolveInitialMaxOutputTokens(chunk.length, 'check'),
      });
      const checkChunkAnswers = extractAnswerIndexMap(checkResult.answers);
      completedSteps += 1;
      reportAiProgress(onProgress, {
        stage: 'check-complete',
        percent: Math.round((completedSteps / totalSteps) * 100),
        chunkIndex: chunkIndex + 1,
        chunkCount: questionChunks.length,
        completedSteps,
        totalSteps,
      });

      Object.assign(checkAnswers, checkChunkAnswers);
      checkTexts.push(checkResult.rawText);
    }
  }

  const disagreements = [];
  if (useChecker) {
    for (let index = 0; index < questions.length; index += 1) {
      const questionNumber = index + 1;
      if (primaryAnswers[questionNumber] !== checkAnswers[questionNumber]) {
        disagreements.push({
          questionNumber,
          primary: primaryAnswers[questionNumber],
          checker: checkAnswers[questionNumber],
        });
      }
    }
  }

  const suspiciousQuestions = buildSuspiciousQuestions({
    questions,
    primaryInsights,
    checkAnswers: useChecker ? checkAnswers : null,
    disagreements,
    mode: normalizedMode,
  });

  const resolvedQuestions = questions.map((question, index) => {
    const questionNumber = index + 1;
    const answerIndex = Number(primaryAnswers[questionNumber]);
    if (!Number.isInteger(answerIndex) || answerIndex < 1 || answerIndex > question.options.length) {
      const error = new Error(`AI returned invalid answer index for question ${questionNumber}.`);
      error.statusCode = 422;
      throw error;
    }

    return {
      ...question,
      correctIndex: answerIndex - 1,
    };
  });

  return {
    questions: resolvedQuestions,
    answerKeyText: formatAnswerKeyText(primaryAnswers, questions.length),
    mode: normalizedMode,
    primaryModel,
    checkModel: useChecker ? checkModel : null,
    disagreements,
    suspiciousQuestions,
    primaryRaw: primaryTexts.join('\n'),
    checkRaw: checkTexts.join('\n'),
  };
}

function reportAiProgress(callback, payload) {
  if (typeof callback !== 'function') {
    return;
  }

  callback({
    stage: payload.stage,
    percent: Math.max(0, Math.min(100, Number(payload.percent) || 0)),
    chunkIndex: Number(payload.chunkIndex || 0),
    chunkCount: Number(payload.chunkCount || 0),
    completedSteps: Number(payload.completedSteps || 0),
    totalSteps: Number(payload.totalSteps || 0),
  });
}

function buildMockAiResult(questions) {
  const answers = {};
  for (let questionNumber = 1; questionNumber <= questions.length; questionNumber += 1) {
    answers[questionNumber] = 1;
  }

  return {
    questions: questions.map((question) => ({
      ...question,
      correctIndex: 0,
    })),
    answerKeyText: formatAnswerKeyText(answers, questions.length),
    mode: 'double',
    primaryModel: 'mock-primary',
    checkModel: 'mock-check',
    disagreements: [],
    suspiciousQuestions: [],
    primaryRaw: formatAnswerKeyText(answers, questions.length),
    checkRaw: formatAnswerKeyText(answers, questions.length),
  };
}

async function createOpenAIAnswersResponse({
  apiKey,
  model,
  passType,
  detailed = false,
  requestContext,
  reasoningEffort,
  prompt,
  expectedQuestionNumbers,
  maxAnswerIndex,
  maxOutputTokens,
}) {
  const responseFormat = {
    type: 'json_schema',
    name: 'quiz_answers',
    strict: true,
    schema: buildAnswerSchema(expectedQuestionNumbers, maxAnswerIndex, detailed),
  };

  let currentMaxOutputTokens = Math.max(2000, Number(maxOutputTokens) || 0);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    reserveAiRequestSlot({
      requestKind: passType || 'answers',
      model,
      title: requestContext?.title || null,
      sourceFilename: requestContext?.sourceFilename || null,
      browserId: requestContext?.browserId || null,
      fingerprint: requestContext?.fingerprint || null,
      requestIp: requestContext?.requestIp || null,
      requestUserAgent: requestContext?.requestUserAgent || null,
    });

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        reasoning: {
          effort: reasoningEffort,
        },
        input: prompt,
        text: {
          format: responseFormat,
        },
        max_output_tokens: currentMaxOutputTokens,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `OpenAI request failed with status ${response.status}.`);
      error.statusCode = 502;
      throw error;
    }

    const outputText = extractResponseText(payload);
    const parsedObject = extractStructuredAnswerObject(payload, outputText);
    if (parsedObject) {
      const answers = normalizeStructuredAnswers(parsedObject, expectedQuestionNumbers, detailed);
      return {
        answers,
        rawText: outputText || JSON.stringify(parsedObject),
      };
    }

    const incompleteReason = String(payload?.incomplete_details?.reason || '').trim();
    const canRetryForOutputLimit = payload?.status === 'incomplete' && incompleteReason === 'max_output_tokens' && attempt < 3;
    console.error('OpenAI returned an unusable answer payload.', JSON.stringify({
      attempt,
      model,
      reasoningEffort,
      max_output_tokens: currentMaxOutputTokens,
      status: payload?.status,
      incomplete_details: payload?.incomplete_details,
      error: payload?.error,
      output_preview: Array.isArray(payload?.output) ? payload.output.slice(0, 3) : payload?.output,
      output_text: typeof payload?.output_text === 'string' ? payload.output_text.slice(0, 500) : payload?.output_text,
    }));

    if (canRetryForOutputLimit) {
      currentMaxOutputTokens = Math.min(currentMaxOutputTokens * 2, 24000);
      continue;
    }

    const error = new Error(
      incompleteReason === 'max_output_tokens'
        ? 'OpenAI hit the output token limit before finishing the answer.'
        : 'OpenAI returned an empty or invalid answer payload.',
    );
    error.statusCode = 502;
    throw error;
  }
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  if (!Array.isArray(payload?.output)) {
    return '';
  }

  const textParts = [];
  for (const item of payload.output) {
    if (!Array.isArray(item?.content)) {
      continue;
    }

    for (const content of item.content) {
      if ((content?.type === 'output_text' || content?.type === 'text') && typeof content.text === 'string') {
        textParts.push(content.text);
      }
    }
  }

  return textParts.join('\n').trim();
}

function extractStructuredAnswerObject(payload, outputText) {
  const jsonCandidates = [];

  if (typeof outputText === 'string' && outputText.trim()) {
    jsonCandidates.push(outputText.trim());
  }

  if (Array.isArray(payload?.output)) {
    for (const item of payload.output) {
      if (!Array.isArray(item?.content)) {
        continue;
      }

      for (const content of item.content) {
        if (typeof content?.json === 'string' && content.json.trim()) {
          jsonCandidates.push(content.json.trim());
        }

        if (content?.parsed && typeof content.parsed === 'object') {
          return content.parsed;
        }

        if (typeof content?.text === 'string' && content.text.trim()) {
          jsonCandidates.push(content.text.trim());
        }
      }
    }
  }

  for (const candidate of jsonCandidates) {
    try {
      return JSON.parse(candidate);
    } catch (_error) {
      continue;
    }
  }

  return null;
}

function normalizeStructuredAnswers(parsedObject, expectedQuestionNumbers, detailed = false) {
  const rows = Array.isArray(parsedObject?.answers) ? parsedObject.answers : [];
  const answers = {};
  for (const row of rows) {
    const questionNumber = Number(row?.questionNumber);
    const answerIndex = Number(row?.answerIndex);
    if (Number.isInteger(questionNumber) && Number.isInteger(answerIndex)) {
      answers[questionNumber] = detailed
        ? {
          questionNumber,
          answerIndex,
          confidence: normalizeAiConfidence(row?.confidence),
          needsReview: Boolean(row?.needsReview),
          note: sanitizeAiNote(row?.note),
        }
        : {
          questionNumber,
          answerIndex,
        };
    }
  }

  const missing = [];
  for (const questionNumber of expectedQuestionNumbers) {
    if (!answers[questionNumber] || !Number.isInteger(Number(answers[questionNumber].answerIndex))) {
      missing.push(questionNumber);
    }
  }

  if (missing.length) {
    const error = new Error(`AI did not return answers for questions: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '...' : ''}`);
    error.statusCode = 422;
    throw error;
  }

  return answers;
}

function buildAnswerSchema(expectedQuestionNumbers, maxAnswerIndex, detailed = false) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['answers'],
    properties: {
      answers: {
        type: 'array',
        minItems: expectedQuestionNumbers.length,
        maxItems: expectedQuestionNumbers.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: detailed
            ? ['questionNumber', 'answerIndex', 'confidence', 'needsReview', 'note']
            : ['questionNumber', 'answerIndex'],
          properties: {
            questionNumber: {
              type: 'integer',
              enum: expectedQuestionNumbers,
            },
            answerIndex: {
              type: 'integer',
              minimum: 1,
              maximum: Math.max(1, Number(maxAnswerIndex) || 1),
            },
            ...(detailed ? {
              confidence: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
              },
              needsReview: {
                type: 'boolean',
              },
              note: {
                type: 'string',
                maxLength: 220,
              },
            } : {}),
          },
        },
      },
    },
  };
}

function formatAnswerKeyText(answers, expectedCount) {
  const lines = [];
  for (let questionNumber = 1; questionNumber <= expectedCount; questionNumber += 1) {
    lines.push(`${questionNumber}.${answers[questionNumber]}`);
  }
  return lines.join('\n');
}

function extractAnswerIndexMap(answerRows) {
  const answers = {};
  for (const [questionNumber, row] of Object.entries(answerRows || {})) {
    const numericQuestionNumber = Number(questionNumber);
    const answerIndex = Number(row?.answerIndex);
    if (Number.isInteger(numericQuestionNumber) && Number.isInteger(answerIndex)) {
      answers[numericQuestionNumber] = answerIndex;
    }
  }
  return answers;
}

function buildPrimaryInsightsMap(answerRows) {
  const insights = {};
  for (const [questionNumber, row] of Object.entries(answerRows || {})) {
    const numericQuestionNumber = Number(questionNumber);
    if (!Number.isInteger(numericQuestionNumber)) {
      continue;
    }

    insights[numericQuestionNumber] = {
      answerIndex: Number(row?.answerIndex),
      confidence: normalizeAiConfidence(row?.confidence),
      needsReview: Boolean(row?.needsReview),
      note: sanitizeAiNote(row?.note),
    };
  }
  return insights;
}

function normalizeAiConfidence(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'low' || normalized === 'medium') {
    return normalized;
  }
  return 'high';
}

function sanitizeAiNote(value) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized.slice(0, 220);
}

function buildSuspiciousQuestions({ questions, primaryInsights, checkAnswers, disagreements, mode }) {
  const disagreementMap = new Map(
    Array.isArray(disagreements)
      ? disagreements.map((item) => [Number(item.questionNumber), item])
      : [],
  );
  const suspicious = [];

  for (let index = 0; index < questions.length; index += 1) {
    const questionNumber = index + 1;
    const insight = primaryInsights[questionNumber] || {};
    const disagreement = disagreementMap.get(questionNumber) || null;
    const reasons = [];

    if (insight.needsReview) {
      reasons.push('model_marked_review');
    }
    if (insight.confidence === 'low') {
      reasons.push('low_confidence');
    }
    if (disagreement) {
      reasons.push('model_disagreement');
    }

    if (!reasons.length) {
      continue;
    }

    suspicious.push({
      questionNumber,
      confidence: insight.confidence || 'high',
      primaryAnswer: Number.isInteger(Number(insight.answerIndex)) ? Number(insight.answerIndex) : null,
      checkerAnswer: disagreement ? Number(disagreement.checker || 0) || null : null,
      needsReview: Boolean(insight.needsReview),
      note: insight.note || '',
      reasons,
      mode,
      questionPreview: String(questions[index]?.q || '').slice(0, 160),
      optionCount: Array.isArray(questions[index]?.options) ? questions[index].options.length : 0,
      checkerUsed: Boolean(checkAnswers),
    });
  }

  return suspicious;
}

function resolveChunkSize() {
  const configured = Number(process.env.OPENAI_CHUNK_SIZE || 120);
  if (!Number.isInteger(configured) || configured < 20) {
    return 120;
  }

  return configured;
}

function resolveInitialMaxOutputTokens(chunkLength, passType) {
  const multiplier = passType === 'primary' ? 80 : 36;
  const floor = passType === 'primary' ? 6000 : 3000;
  return Math.max(floor, chunkLength * multiplier);
}

function resolveReasoningEffort(passType) {
  const envKey = passType === 'primary' ? 'OPENAI_PRIMARY_REASONING' : 'OPENAI_CHECK_REASONING';
  const configured = String(process.env[envKey] || '').trim().toLowerCase();
  if (configured === 'low' || configured === 'medium' || configured === 'high') {
    return configured;
  }

  return 'low';
}

function chunkQuestions(questions, chunkSize) {
  if (!Array.isArray(questions) || questions.length <= chunkSize) {
    return [questions];
  }

  const chunks = [];
  for (let index = 0; index < questions.length; index += chunkSize) {
    chunks.push(questions.slice(index, index + chunkSize));
  }
  return chunks;
}

function buildPrimaryPrompt({
  filename,
  optionCount,
  compactQuestions,
  chunkIndex,
  chunkCount,
}) {
  const parts = [
    'You are validating answers for a multiple-choice medical quiz.',
    'Return the answers only for the parsed questions provided below.',
    'Choose exactly one answer option for every question.',
    'For every question, also estimate confidence as high, medium, or low.',
    'Set needsReview=true when the parsed question looks ambiguous, damaged, OCR-corrupted, or otherwise doubtful.',
    'Write a short note explaining why review is needed or why confidence is not high. Use an empty string when there is no issue.',
    'Do not infer extra questions and do not skip any question.',
    '',
    `Filename: ${filename || 'quiz file'}`,
    `Expected option count per question: ${optionCount || compactQuestions[0]?.options?.length || 0}`,
  ];

  if (chunkCount > 1) {
    parts.push(`Chunk ${chunkIndex + 1} of ${chunkCount}. Keep the original global question numbers.`);
  }

  parts.push('', 'Parsed questions and answer options:', JSON.stringify(compactQuestions));
  return parts.join('\n');
}

function buildCheckPrompt({ compactQuestions, chunkIndex, chunkCount }) {
  const parts = [
    'You are checking answer correctness for a parsed medical multiple-choice quiz.',
    'Return only plain text lines in the format questionNumber.answerIndex.',
    'Example:',
    '1.2',
    '2.1',
    '3.4',
    'Do not return explanations, JSON, markdown, headings, or extra text.',
  ];

  if (chunkCount > 1) {
    parts.push('', `Chunk ${chunkIndex + 1} of ${chunkCount}. Keep the original global question numbers.`);
  }

  parts.push('', 'Use only the parsed questions below.', JSON.stringify(compactQuestions));
  return parts.join('\n');
}
