const OPENAI_API_URL = 'https://api.openai.com/v1/responses';

export async function solveQuizAnswersWithAI({
  filename,
  extractedText,
  questions,
  optionCount,
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
  const primaryAnswers = {};
  const checkAnswers = {};
  const primaryTexts = [];
  const checkTexts = [];

  for (let chunkIndex = 0; chunkIndex < questionChunks.length; chunkIndex += 1) {
    const chunk = questionChunks[chunkIndex];
    const questionNumbers = chunk.map((item) => item.number);
    const includeRawText = questionChunks.length === 1;

    const primaryPrompt = buildPrimaryPrompt({
      filename,
      extractedText,
      optionCount,
      compactQuestions: chunk,
      chunkIndex,
      chunkCount: questionChunks.length,
      includeRawText,
    });

    const checkPrompt = buildCheckPrompt({
      compactQuestions: chunk,
      chunkIndex,
      chunkCount: questionChunks.length,
    });

    const primaryText = await createOpenAITextResponse({
      apiKey,
      model: primaryModel,
      reasoningEffort: 'high',
      prompt: primaryPrompt,
      maxOutputTokens: Math.max(240, chunk.length * 12),
    });
    const primaryChunkAnswers = parseAiAnswerLines(primaryText, questionNumbers);

    const checkText = await createOpenAITextResponse({
      apiKey,
      model: checkModel,
      reasoningEffort: 'medium',
      prompt: checkPrompt,
      maxOutputTokens: Math.max(240, chunk.length * 12),
    });
    const checkChunkAnswers = parseAiAnswerLines(checkText, questionNumbers);

    Object.assign(primaryAnswers, primaryChunkAnswers);
    Object.assign(checkAnswers, checkChunkAnswers);
    primaryTexts.push(primaryText);
    checkTexts.push(checkText);
  }

  const disagreements = [];
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
    primaryModel,
    checkModel,
    disagreements,
    primaryRaw: primaryTexts.join('\n'),
    checkRaw: checkTexts.join('\n'),
  };
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
    primaryModel: 'mock-primary',
    checkModel: 'mock-check',
    primaryRaw: formatAnswerKeyText(answers, questions.length),
    checkRaw: formatAnswerKeyText(answers, questions.length),
  };
}

async function createOpenAITextResponse({
  apiKey,
  model,
  reasoningEffort,
  prompt,
  maxOutputTokens,
}) {
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
      max_output_tokens: maxOutputTokens,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `OpenAI request failed with status ${response.status}.`);
    error.statusCode = 502;
    throw error;
  }

  const outputText = extractResponseText(payload);
  if (!outputText) {
    const error = new Error('OpenAI returned an empty answer payload.');
    error.statusCode = 502;
    throw error;
  }

  return outputText.trim();
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

function parseAiAnswerLines(rawText, expectedInput) {
  const answers = {};
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^(\d+)\s*[\.\-:]\s*(\d+)$/);
    if (!match) {
      continue;
    }

    answers[Number(match[1])] = Number(match[2]);
  }

  const expectedNumbers = Array.isArray(expectedInput)
    ? expectedInput
    : Array.from({ length: Number(expectedInput || 0) }, (_unused, index) => index + 1);

  const missing = [];
  for (const questionNumber of expectedNumbers) {
    if (!Number.isInteger(answers[questionNumber])) {
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

function formatAnswerKeyText(answers, expectedCount) {
  const lines = [];
  for (let questionNumber = 1; questionNumber <= expectedCount; questionNumber += 1) {
    lines.push(`${questionNumber}.${answers[questionNumber]}`);
  }
  return lines.join('\n');
}

function resolveChunkSize() {
  const configured = Number(process.env.OPENAI_CHUNK_SIZE || 120);
  if (!Number.isInteger(configured) || configured < 20) {
    return 120;
  }

  return configured;
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
  extractedText,
  optionCount,
  compactQuestions,
  chunkIndex,
  chunkCount,
  includeRawText,
}) {
  const parts = [
    'You are validating answers for a multiple-choice medical quiz.',
    'Return only plain text lines in the format questionNumber.answerIndex.',
    'Example:',
    '1.2',
    '2.1',
    '3.4',
    'Do not return explanations, JSON, markdown, headings, or extra text.',
    '',
    `Filename: ${filename || 'quiz file'}`,
    `Expected option count per question: ${optionCount || compactQuestions[0]?.options?.length || 0}`,
  ];

  if (chunkCount > 1) {
    parts.push(`Chunk ${chunkIndex + 1} of ${chunkCount}. Keep the original global question numbers.`);
  }

  if (includeRawText) {
    parts.push('', 'Raw extracted source text:', extractedText || '');
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
