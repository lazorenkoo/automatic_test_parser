const quizForm = document.getElementById('quizForm');
const submitBtn = document.getElementById('submitBtn');
const statusBox = document.getElementById('statusBox');
const resultBox = document.getElementById('resultBox');
const clientTitleInput = document.getElementById('clientTitle');
const clientTgUsernameInput = document.getElementById('clientTgUsername');
const courseNumberInput = document.getElementById('courseNumber');
const sourceFileInput = document.getElementById('sourceFile');
const answerFileInput = document.getElementById('answerFile');
const answerIndexSelect = document.getElementById('answerIndex');
const optionCountInput = document.getElementById('optionCount');
const optionCountAutoInput = document.getElementById('optionCountAuto');
const fastParserModeInput = document.getElementById('fastParserMode');
const answerModeSingleInput = document.getElementById('answerModeSingle');
const answerModeFileInput = document.getElementById('answerModeFile');
const singleAnswerField = document.getElementById('singleAnswerField');
const answerFileField = document.getElementById('answerFileField');
const aiCreateBtn = document.getElementById('aiCreateBtn');
const reportIssueBtn = document.getElementById('reportIssueBtn');
const myTestsBtn = document.getElementById('myTestsBtn');
const myTestsPanel = document.getElementById('myTestsPanel');
const myTestsStatus = document.getElementById('myTestsStatus');
const myTestsList = document.getElementById('myTestsList');
const closeMyTestsBtn = document.getElementById('closeMyTestsBtn');
const siteNoticeCard = document.getElementById('siteNoticeCard');
const siteNoticeText = document.getElementById('siteNoticeText');
const siteNoticeTime = document.getElementById('siteNoticeTime');
const deviceWarningModal = document.getElementById('deviceWarningModal');
const deviceWarningModalText = document.getElementById('deviceWarningModalText');
const deviceWarningModalTime = document.getElementById('deviceWarningModalTime');
const deviceWarningCloseBtn = document.getElementById('deviceWarningCloseBtn');
const puterUsageFooter = document.getElementById('puterUsageFooter');

let currentDraftToken = '';
let currentDraftPayload = null;
let validatedAccessCode = '';
let validatedCodePayload = null;
let currentAiJobId = '';
let rememberedClientTgUsernamePromise = null;
let adminBootstrapPromise = null;
let puterUsageRefreshPromise = null;
let activeDeviceWarningSignature = '';
let adminBootstrap = {
  puterParserRepairEnabled: true,
  puterParserRepairModel: 'google/gemini-2.5-flash-lite',
  puterParserRepairBatchSize: 80,
  puterAnswerModel: 'google/gemini-2.5-flash-lite',
};

loadSiteNotice();
void loadAdminBootstrap();
loadStoredClientTgUsername();
void loadRememberedClientTgUsername();
syncBrowserIdCookie();
loadDeviceWarning();
void schedulePuterUsageRefresh();
syncOptionCountMode();
syncAnswerIndexOptions();
syncAnswerMode();
syncReportButtonVisibility();

optionCountInput.addEventListener('input', syncAnswerIndexOptions);
optionCountAutoInput?.addEventListener('change', syncOptionCountMode);
answerModeSingleInput.addEventListener('change', syncAnswerMode);
answerModeFileInput.addEventListener('change', syncAnswerMode);
sourceFileInput.addEventListener('change', syncReportButtonVisibility);
answerFileInput.addEventListener('change', syncReportButtonVisibility);
clientTgUsernameInput?.addEventListener('input', persistClientTgUsername);
aiCreateBtn?.addEventListener('click', prepareAiQuiz);
reportIssueBtn?.addEventListener('click', reportCurrentUploadIssue);
myTestsBtn?.addEventListener('click', openMyTestsPanel);
closeMyTestsBtn?.addEventListener('click', closeMyTestsPanel);
deviceWarningCloseBtn?.addEventListener('click', closeDeviceWarningModal);
deviceWarningModal?.addEventListener('click', (event) => {
  if (event.target === deviceWarningModal) {
    closeDeviceWarningModal();
  }
});

quizForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  setParserProgressStatus(10);
  clearResultState();
  submitBtn.disabled = true;

  try {
    const clientTitle = String(clientTitleInput?.value || '').trim();
    const clientTgUsername = await ensureClientTgUsername();
    const courseNumber = Number(courseNumberInput?.value || 0);
    const sourceFile = sourceFileInput.files?.[0];
    const answerMode = getAnswerMode();

    if (!Number.isInteger(courseNumber) || courseNumber < 1 || courseNumber > 10) {
      throw new Error('Спочатку оберіть курс від 1 до 10.');
    }

    if (!clientTitle) {
      throw new Error('Спочатку введіть назву тесту.');
    }

    if (!sourceFile) {
      throw new Error('Спочатку виберіть файл із тестами.');
    }

    persistClientTgUsername();

    const formData = new FormData();
    formData.append('courseNumber', String(courseNumber));
    formData.append('clientTitle', clientTitle);
    formData.append('sourceFile', sourceFile);
    formData.append('optionCount', getOptionCountRequestValue());
    formData.append('answerMode', answerMode);

    if (answerMode === 'single') {
      formData.append('answerIndex', String(answerIndexSelect.value || 1));
    } else {
      const answerFile = answerFileInput.files?.[0];
      if (!answerFile) {
        throw new Error('Потрібно завантажити окремий файл із відповідями.');
      }
      formData.append('answerFile', answerFile);
    }

    const response = await fetch('/api/parse', {
      method: 'POST',
      body: formData,
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Не вдалося обробити файл.');
    }

    currentDraftToken = payload.draftToken;
    currentDraftToken = String(payload.draftToken || '');
    currentDraftPayload = payload;
    const repairedPayload = fastParserModeInput?.checked
      ? payload
      : await maybeRepairParsedDraft(payload);
    currentDraftPayload = repairedPayload;
    setStatus('success', 'Тест готовий.');
    setParserProgressStatus(100);
    renderDraftResult(repairedPayload);
    await finalizeCurrentDraft('');
  } catch (error) {
    setStatus('error', error.message || 'Не вдалося обробити файл.');
  } finally {
    submitBtn.disabled = false;
  }
});

function setStatus(kind, message) {
  statusBox.className = `status ${kind}`;
  statusBox.textContent = message;
}

function setParserProgressStatus(percent) {
  const numericPercent = Number(percent);
  const safePercent = Number.isFinite(numericPercent)
    ? Math.max(0, Math.min(100, Math.round(numericPercent)))
    : 0;
  setStatus('loading', `Файл обробляється парсером... ${safePercent}%`);
}

function clearResultState() {
  currentDraftToken = '';
  currentDraftPayload = null;
  validatedAccessCode = '';
  validatedCodePayload = null;
  currentAiJobId = '';
  resultBox.classList.add('hidden');
  resultBox.innerHTML = '';
}

async function loadAdminBootstrap(forceRefresh = false) {
  if (!forceRefresh && adminBootstrapPromise) {
    return adminBootstrapPromise;
  }

  adminBootstrapPromise = (async () => {
    try {
      const response = await fetch('/api/admin-bootstrap');
      const payload = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load admin bootstrap.');
      }

      adminBootstrap = {
        ...adminBootstrap,
        puterParserRepairEnabled: Boolean(payload.puterParserRepairEnabled),
        puterParserRepairModel: String(payload.puterParserRepairModel || adminBootstrap.puterParserRepairModel || 'google/gemini-2.5-flash-lite'),
        puterParserRepairBatchSize: Math.max(1, Math.min(100, Number(payload.puterParserRepairBatchSize || adminBootstrap.puterParserRepairBatchSize || 80) || 80)),
        puterAnswerModel: String(payload.puterAnswerModel || adminBootstrap.puterAnswerModel || 'google/gemini-2.5-flash-lite'),
      };
    } catch (_error) {
      // Keep default bootstrap values.
    }

    return adminBootstrap;
  })();

  return adminBootstrapPromise;
}

function isPuterParserRepairAvailable() {
  return Boolean(
    adminBootstrap.puterParserRepairEnabled
    && window.puter
    && window.puter.ai
    && typeof window.puter.ai.chat === 'function'
  );
}

function isPuterAnsweringAvailable() {
  return Boolean(
    window.puter
    && window.puter.ai
    && typeof window.puter.ai.chat === 'function'
  );
}

function buildParserRepairMessages(batchQuestions, sourceSnippet, batchIndex, batchCount) {
  const compactQuestions = batchQuestions.map((question, index) => ({
    sourceQuestionNumber: Number(question.sourceQuestionNumber || index + 1),
    q: question.q,
    options: Array.isArray(question.options) ? question.options : [],
    correctIndex: Number.isInteger(question.correctIndex) ? question.correctIndex : 0,
  }));

  const rules = [
    'Ти виправляєш JSON медичного тесту після локального парсера.',
    'Виправляй лише очевидні помилки переносу, OCR, обриви та склейки слів.',
    'Не змінюй порядок питань.',
    'Не додавай і не видаляй питання.',
    'Не вигадуй нову інформацію.',
    'Зберігай correctIndex, якщо немає явної причини для зміни.',
    'Поверни тільки JSON без markdown у форматі {"questions":[...]}',
    'У кожному елементі залиш поля q, options, correctIndex, sourceQuestionNumber.',
  ];

  const parts = [
    rules.join('\n'),
    `Батч ${batchIndex + 1} з ${batchCount}.`,
    `Поточний JSON:\n${JSON.stringify(compactQuestions)}`,
  ];

  if (sourceSnippet) {
    parts.push(`Фрагмент сирого тексту:\n${sourceSnippet}`);
  }

  return [
    {
      role: 'user',
      content: parts.join('\n\n'),
    },
  ];
}

function extractPuterChatText(response) {
  if (!response) {
    return '';
  }

  if (typeof response === 'string') {
    return response.trim();
  }

  const directCandidates = [
    response.text,
    response.output,
    response.result,
    response.content,
    response.message?.content,
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  if (Array.isArray(response.message?.content)) {
    const joined = response.message.content
      .map((item) => typeof item?.text === 'string' ? item.text : '')
      .filter(Boolean)
      .join('\n')
      .trim();
    if (joined) {
      return joined;
    }
  }

  if (Array.isArray(response.choices)) {
    for (const choice of response.choices) {
      const choiceText = extractPuterChatText(choice?.message || choice);
      if (choiceText) {
        return choiceText;
      }
    }
  }

  return '';
}

function parseJsonFromModelText(text) {
  const rawText = String(text || '').trim();
  if (!rawText) {
    throw new Error('Empty parser refinement response.');
  }

  try {
    return JSON.parse(rawText);
  } catch {
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(rawText.slice(start, end + 1));
    }
  }

  throw new Error('Could not parse refined parser JSON.');
}

function buildBatchSourceSnippet(extractedText, startQuestionNumber, endQuestionNumber) {
  const sourceText = String(extractedText || '').trim();
  if (!sourceText) {
    return '';
  }

  const startPattern = new RegExp(`(?:^|\\n)\\s*${startQuestionNumber}[.)]\\s`, 'i');
  const nextPattern = new RegExp(`(?:^|\\n)\\s*${endQuestionNumber + 1}[.)]\\s`, 'i');
  const startMatch = startPattern.exec(sourceText);
  const startIndex = startMatch ? startMatch.index : 0;
  const sliced = sourceText.slice(startIndex);
  const nextMatch = nextPattern.exec(sliced);
  const endIndex = nextMatch ? startIndex + nextMatch.index : Math.min(sourceText.length, startIndex + 12000);
  return sourceText.slice(startIndex, endIndex).trim().slice(0, 12000);
}

function chunkQuestionsForRepair(questions, chunkSize = 80) {
  const chunks = [];
  for (let index = 0; index < questions.length; index += chunkSize) {
    chunks.push(questions.slice(index, index + chunkSize));
  }
  return chunks;
}

async function requestPuterParserRepair(batchQuestions, sourceSnippet, batchIndex, batchCount) {
  const messages = buildParserRepairMessages(batchQuestions, sourceSnippet, batchIndex, batchCount);
  console.log('[parser-repair] puter request start', {
    batchIndex,
    batchCount,
    questionCount: batchQuestions.length,
    model: adminBootstrap.puterParserRepairModel,
    hasSourceSnippet: Boolean(sourceSnippet),
  });

  const response = await window.puter.ai.chat(messages, {
    model: adminBootstrap.puterParserRepairModel,
  });
  const rawText = extractPuterChatText(response);
  const parsed = parseJsonFromModelText(rawText);
  const repairedQuestions = Array.isArray(parsed?.questions) ? parsed.questions : [];

  if (repairedQuestions.length !== batchQuestions.length) {
    throw new Error(`Refinement returned ${repairedQuestions.length} questions for a batch of ${batchQuestions.length}.`);
  }

  return repairedQuestions;
}

async function maybeRepairParsedDraft(payload) {
  await loadAdminBootstrap();

  const draftToken = String(payload?.draftToken || '').trim();
  const questions = Array.isArray(payload?.questions) ? payload.questions : [];
  const extractedText = String(payload?.extractedText || '');

  if (!draftToken || !questions.length || !isPuterParserRepairAvailable()) {
    return payload;
  }

  setParserProgressStatus(55);
  const chunks = chunkQuestionsForRepair(questions, adminBootstrap.puterParserRepairBatchSize || 80);
  const repairedQuestions = [];
  let usedRawText = false;

  try {
    for (let batchIndex = 0; batchIndex < chunks.length; batchIndex += 1) {
      const batch = chunks[batchIndex];
      const firstQuestionNumber = Number(batch[0]?.sourceQuestionNumber || batchIndex * 20 + 1);
      const lastQuestionNumber = Number(batch[batch.length - 1]?.sourceQuestionNumber || firstQuestionNumber + batch.length - 1);
      const sourceSnippet = buildBatchSourceSnippet(extractedText, firstQuestionNumber, lastQuestionNumber);
      if (sourceSnippet) {
        usedRawText = true;
      }
      const progress = 55 + (((batchIndex + 1) / Math.max(1, chunks.length)) * 40);
      setParserProgressStatus(progress);
      const repairedBatch = await requestPuterParserRepair(batch, sourceSnippet, batchIndex, chunks.length);
      repairedQuestions.push(...repairedBatch);
    }

    const repairResponse = await fetch('/api/drafts/repair', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        draftToken,
        questions: repairedQuestions,
        reviewBlocks: Array.isArray(payload.reviewBlocks) ? payload.reviewBlocks : [],
        notes: [
          `Додаткова перевірка структури виконана для ${chunks.length} блок${chunks.length === 1 ? 'у' : 'ів'}.`,
        ],
        parserRepair: {
          model: adminBootstrap.puterParserRepairModel,
          batchCount: chunks.length,
          usedRawText,
        },
      }),
    });
    const repairPayload = await readJsonResponse(repairResponse);
    if (!repairResponse.ok) {
      throw new Error(repairPayload.error || 'Failed to save repaired parser result.');
    }

    setParserProgressStatus(98);

    console.log('[parser-repair] draft updated', {
      draftToken,
      parsedCount: repairPayload.parsedCount,
      model: adminBootstrap.puterParserRepairModel,
    });

    return {
      ...payload,
      parsedCount: repairPayload.parsedCount || payload.parsedCount,
      questions: repairedQuestions,
      reviewBlocks: Array.isArray(payload.reviewBlocks) ? payload.reviewBlocks : [],
      notes: Array.isArray(repairPayload.notes) && repairPayload.notes.length
        ? repairPayload.notes
        : (Array.isArray(payload.notes) ? payload.notes : []),
      rawModelJson: repairPayload.rawModelJson || payload.rawModelJson || {},
    };
  } catch (error) {
    console.warn('[parser-repair] skipped', {
      message: error?.message || String(error || ''),
    });
    setParserProgressStatus(98);
    return {
      ...payload,
      notes: [
        ...(Array.isArray(payload.notes) ? payload.notes : []),
        'Додаткову перевірку структури пропущено. Використано результат локального парсера.',
      ],
    };
  } finally {
    void refreshPuterUsageFooter(true);
  }
}

function normalizeClientTgUsername(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/^@+/, '');
  return normalized ? `@${normalized}` : '';
}

function loadStoredClientTgUsername() {
  if (!clientTgUsernameInput) {
    return;
  }

  try {
    const storedValue = window.localStorage.getItem('pdmu_client_tg_username');
    if (storedValue && !clientTgUsernameInput.value) {
      clientTgUsernameInput.value = storedValue;
    }
  } catch {
    // Ignore storage failures.
  }
}

function persistClientTgUsername() {
  const normalized = normalizeClientTgUsername(clientTgUsernameInput?.value || '');
  try {
    if (normalized) {
      window.localStorage.setItem('pdmu_client_tg_username', normalized);
    } else {
      window.localStorage.removeItem('pdmu_client_tg_username');
    }
  } catch {
    // Ignore storage failures.
  }
}

async function resolveRememberedClientTgUsername(forceRefresh = false) {
  if (!forceRefresh && rememberedClientTgUsernamePromise) {
    return rememberedClientTgUsernamePromise;
  }

  rememberedClientTgUsernamePromise = (async () => {
    try {
      const response = await fetch('/api/client-binding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          creatorProfile: await buildCreatorProfile(),
        }),
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(payload.error || 'Could not load the saved Telegram username for this device.');
      }
      return normalizeClientTgUsername(payload.clientTgUsername || '');
    } catch {
      return '';
    }
  })();

  return rememberedClientTgUsernamePromise;
}

async function loadRememberedClientTgUsername() {
  if (!clientTgUsernameInput) {
    return '';
  }

  const rememberedUsername = await resolveRememberedClientTgUsername();
  if (rememberedUsername && !normalizeClientTgUsername(clientTgUsernameInput.value)) {
    clientTgUsernameInput.value = rememberedUsername;
    persistClientTgUsername();
  }

  return rememberedUsername;
}

async function ensureClientTgUsername() {
  const normalized = normalizeClientTgUsername(clientTgUsernameInput?.value || '');
  if (normalized) {
    persistClientTgUsername();
    return normalized;
  }

  const rememberedUsername = await loadRememberedClientTgUsername();
  if (rememberedUsername) {
    return rememberedUsername;
  }

  return '';
}

function rememberResolvedClientTgUsername(value) {
  const normalized = normalizeClientTgUsername(value || '');
  rememberedClientTgUsernamePromise = Promise.resolve(normalized);
  if (normalized && clientTgUsernameInput && !normalizeClientTgUsername(clientTgUsernameInput.value)) {
    clientTgUsernameInput.value = normalized;
    persistClientTgUsername();
  }
}

function isPuterUsageAvailable() {
  return Boolean(
    window.puter
    && window.puter.auth
    && typeof window.puter.auth.getMonthlyUsage === 'function'
  );
}

function microcentsToDollars(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return numericValue / 100000000;
}

function formatUsdAmount(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) {
    return '$0.00';
  }

  if (numericValue >= 0.1) {
    return `$${numericValue.toFixed(2)}`;
  }

  return `$${numericValue.toFixed(4)}`;
}

function setPuterUsageText(message) {
  if (!puterUsageFooter) {
    return;
  }

  puterUsageFooter.textContent = message;
}

async function refreshPuterUsageFooter(force = false) {
  if (!puterUsageFooter) {
    return null;
  }

  if (!force && puterUsageRefreshPromise) {
    return puterUsageRefreshPromise;
  }

  puterUsageRefreshPromise = (async () => {
    if (!isPuterUsageAvailable()) {
      setPuterUsageText('Puter limit: unavailable on this device right now.');
      return null;
    }

    try {
      const usage = await window.puter.auth.getMonthlyUsage();
      const allowanceInfo = usage && typeof usage === 'object' ? usage.allowanceInfo : null;
      const remainingDollars = microcentsToDollars(allowanceInfo?.remaining);
      const totalDollars = microcentsToDollars(allowanceInfo?.monthUsageAllowance);

      if (!allowanceInfo || !Number.isFinite(remainingDollars) || !Number.isFinite(totalDollars) || totalDollars <= 0) {
        setPuterUsageText('Puter limit: usage data is not available for this device.');
        return null;
      }

      setPuterUsageText(`Puter free limit left on this device: ${formatUsdAmount(remainingDollars)} of ${formatUsdAmount(totalDollars)}.`);
      return usage;
    } catch (error) {
      const message = String(error?.message || '');
      if (/sign\s*in|login|auth|unauthor/i.test(message)) {
        setPuterUsageText('Puter limit: sign in to Puter to see remaining free allowance.');
      } else {
        setPuterUsageText('Puter limit: could not load remaining free allowance.');
      }
      return null;
    } finally {
      puterUsageRefreshPromise = null;
    }
  })();

  return puterUsageRefreshPromise;
}

async function schedulePuterUsageRefresh() {
  if (!puterUsageFooter) {
    return;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (isPuterUsageAvailable()) {
      await refreshPuterUsageFooter(true);
      return;
    }

    if (attempt === 0) {
      setPuterUsageText('Puter limit: waiting for usage data...');
    }

    await delay(700);
  }

  await refreshPuterUsageFooter(true);
}

async function loadSiteNotice() {
  if (!siteNoticeCard || !siteNoticeText || !siteNoticeTime) {
    return;
  }

  try {
    const response = await fetch('/api/site-notice');
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load site notice.');
    }

    const message = String(payload.message || '').trim();
    const updatedAt = Number(payload.updatedAt || 0);

    if (!message) {
      siteNoticeCard.classList.add('hidden');
      siteNoticeText.textContent = '';
      siteNoticeTime.textContent = '';
      return;
    }

    siteNoticeText.textContent = message;
    siteNoticeTime.textContent = updatedAt > 0 ? formatNoticeDateTime(updatedAt) : '';
    siteNoticeCard.classList.remove('hidden');
  } catch (_error) {
    siteNoticeCard.classList.add('hidden');
  }
}

function formatNoticeDateTime(timestamp) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

function syncReportButtonVisibility() {
  if (!reportIssueBtn && !aiCreateBtn) {
    return;
  }

  const hasFile = Boolean(sourceFileInput.files?.[0] || answerFileInput.files?.[0]);
  reportIssueBtn.classList.toggle('hidden', !hasFile);
  aiCreateBtn?.classList.toggle('hidden', !hasFile);
}

function closeMyTestsPanel() {
  myTestsPanel?.classList.add('hidden');
}

async function openMyTestsPanel() {
  if (!myTestsPanel || !myTestsStatus || !myTestsList) {
    return;
  }

  myTestsPanel.classList.remove('hidden');
  myTestsStatus.className = 'status loading';
  myTestsStatus.textContent = 'Loading active tests from this device.';
  myTestsList.classList.add('hidden');
  myTestsList.innerHTML = '';

  try {
    const response = await fetch('/api/quizzes/mine', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        creatorProfile: await buildCreatorProfile(),
      }),
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || 'Could not load your tests.');
    }

    const quizzes = Array.isArray(payload.quizzes) ? payload.quizzes : [];
    if (!quizzes.length) {
      myTestsStatus.className = 'status idle';
      myTestsStatus.textContent = 'No active tests were found for this device.';
      return;
    }

    myTestsStatus.className = 'status success';
    myTestsStatus.textContent = `Found ${quizzes.length} active test${quizzes.length === 1 ? '' : 's'}.`;
    myTestsList.innerHTML = quizzes.map((quiz) => `
      <article class="my-test-item">
        <div class="my-test-title">${escapeHtml(quiz.title || `Test ${quiz.id}`)}</div>
        <a class="my-test-link" href="${escapeAttr(String(quiz.quizUrl || ''))}" target="_blank" rel="noreferrer">${escapeHtml(String(quiz.quizUrl || ''))}</a>
        <div class="my-test-meta">Expires: ${escapeHtml(formatNoticeDateTime(quiz.expiresAt || 0))}</div>
      </article>
    `).join('');
    myTestsList.classList.remove('hidden');
  } catch (error) {
    myTestsStatus.className = 'status error';
    myTestsStatus.textContent = error.message || 'Could not load your tests.';
  }
}

async function prepareAiQuiz() {
  const clientTitle = String(clientTitleInput?.value || '').trim();
  const courseNumber = Number(courseNumberInput?.value || 0);
  const sourceFile = sourceFileInput.files?.[0] || null;

  if (!Number.isInteger(courseNumber) || courseNumber < 1 || courseNumber > 10) {
    setStatus('error', 'Спочатку оберіть курс від 1 до 10.');
    return;
  }

  if (!clientTitle) {
    setStatus('error', 'Спочатку введіть назву тесту.');
    return;
  }

  if (!sourceFile) {
    setStatus('error', 'Спочатку прикріпіть файл із тестами.');
    return;
  }

  const clientTgUsername = await ensureClientTgUsername();
  aiCreateBtn.disabled = true;
  submitBtn.disabled = true;
  clearResultState();
  setStatus('loading', 'Запускаю локальний парсер');

  try {
    const formData = new FormData();
    formData.append('courseNumber', String(courseNumber));
    formData.append('clientTitle', clientTitle);
    formData.append('sourceFile', sourceFile);
    formData.append('optionCount', getOptionCountRequestValue());
    formData.append('creatorProfile', JSON.stringify(await buildCreatorProfile()));

    const response = await fetch('/api/ai-quizzes/inspect', {
      method: 'POST',
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Не вдалося перевірити файл.');
    }

    currentDraftPayload = payload;
    setStatus('success', `Парсер знайшов ${payload.parsedCount || 0} питань.`);
    renderAiCodeGate(payload);
  } catch (error) {
    setStatus('error', error.message || 'Не вдалося перевірити файл.');
  } finally {
    aiCreateBtn.disabled = false;
    submitBtn.disabled = false;
    reportIssueBtn.disabled = false;
  }
}

async function validateAiAccessCode() {
  if (!currentDraftPayload) {
    setStatus('error', 'Спочатку запусти AI-режим.');
    return;
  }

  const codeInput = document.getElementById('aiAccessCodeInput');
  const code = String(codeInput?.value || '').trim();
  const messageBox = document.getElementById('aiCodeMessage');
  const sendBtn = document.getElementById('aiFinalizeBtn');

  validatedAccessCode = '';
  validatedCodePayload = null;
  if (sendBtn) {
    sendBtn.classList.add('hidden');
    sendBtn.disabled = true;
  }

  if (!code) {
    if (messageBox) {
      messageBox.textContent = 'Введіть код доступу.';
    }
    setStatus('error', 'Введіть код доступу.');
    return;
  }

  if (messageBox) {
    messageBox.textContent = 'Перевіряю код...';
  }

  try {
    const response = await fetch('/api/access-codes/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        accessCode: code,
        parsedCount: currentDraftPayload?.parsedCount || null,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Код не пройшов перевірку.');
    }

    validatedAccessCode = code;
    validatedCodePayload = payload;
    if (messageBox) {
      messageBox.textContent = buildCodeSuccessMessage(payload);
    }
    if (sendBtn) {
      sendBtn.classList.remove('hidden');
      sendBtn.disabled = false;
    }
    setStatus('success', 'Код підтверджено. Можна запускати AI.');
  } catch (error) {
    if (messageBox) {
      messageBox.textContent = error.message || 'Код не пройшов перевірку.';
    }
    setStatus('error', error.message || 'Код не пройшов перевірку.');
  }
}

async function finalizeAiDraft() {
  if (isPuterAiModeSelected()) {
    await finalizePuterAiDraft();
    return;
  }

  await finalizeServerAiDraft();
}

async function finalizeServerAiDraft() {
  const requiresCode = true;
  if (requiresCode && !validatedAccessCode) {
    setStatus('error', 'Спочатку підтвердьте код.');
    return;
  }

  const sendBtn = document.getElementById('aiFinalizeBtn');
  const checkBtn = document.getElementById('aiCheckCodeBtn');
  const codeInput = document.getElementById('aiAccessCodeInput');
  const clientTitle = String(clientTitleInput?.value || '').trim();
  const courseNumber = Number(courseNumberInput?.value || 0);
  const sourceFile = sourceFileInput.files?.[0] || null;

  if (!Number.isInteger(courseNumber) || courseNumber < 1 || courseNumber > 10) {
    setStatus('error', 'Спочатку оберіть курс від 1 до 10.');
    return;
  }

  if (!clientTitle) {
    setStatus('error', 'Спочатку введіть назву тесту.');
    return;
  }

  if (!sourceFile) {
    setStatus('error', 'Спочатку прикріпіть файл із тестами.');
    return;
  }

  if (sendBtn) {
    sendBtn.disabled = true;
  }
  if (checkBtn) {
    checkBtn.disabled = true;
  }
  if (codeInput) {
    codeInput.disabled = true;
  }

  aiCreateBtn.disabled = true;
  submitBtn.disabled = true;
  reportIssueBtn.disabled = true;
  setStatus('loading', 'Файл відправленний');

  try {
    const formData = new FormData();
    formData.append('courseNumber', String(courseNumber));
    formData.append('clientTitle', clientTitle);
    formData.append('sourceFile', sourceFile);
    formData.append('optionCount', getOptionCountRequestValue());
    formData.append('creatorProfile', JSON.stringify(await buildCreatorProfile()));
    formData.append('forceRequireCode', '1');
    if (requiresCode && validatedAccessCode) {
      formData.append('accessCode', validatedAccessCode);
    }

    const prepareResponse = await fetch('/api/ai-quizzes/prepare', {
      method: 'POST',
      body: formData,
    });
    const preparePayload = await readJsonResponse(prepareResponse);
    if (!prepareResponse.ok) {
      throw new Error(preparePayload.error || 'Не вдалося підготувати AI-тест.');
    }

    currentAiJobId = String(preparePayload.jobId || '');
    if (!currentAiJobId) {
      throw new Error('Не вдалося запустити AI-обробку.');
    }

    setStatus('loading', buildAiProgressStatus(preparePayload));
    const completedPayload = await waitForAiPrepareJob(currentAiJobId);
    currentDraftToken = completedPayload.draftToken;
    currentDraftPayload = completedPayload;
    await finalizeCurrentDraft(requiresCode ? validatedAccessCode : '');
  } catch (error) {
    setStatus('error', error.message || 'Не вдалося створити AI-тест.');
    if (sendBtn) {
      sendBtn.disabled = false;
    }
    if (checkBtn) {
      checkBtn.disabled = false;
    }
    if (codeInput) {
      codeInput.disabled = false;
    }
  } finally {
    aiCreateBtn.disabled = false;
    submitBtn.disabled = false;
    reportIssueBtn.disabled = false;
  }
}

async function finalizePuterAiDraft() {
  if (!currentDraftPayload?.draftToken || !Array.isArray(currentDraftPayload?.questions) || !currentDraftPayload.questions.length) {
    setStatus('error', 'Ð¡Ð¿Ð¾Ñ‡Ð°Ñ‚ÐºÑƒ Ð·Ð°Ð¿ÑƒÑÑ‚Ñ–Ñ‚ÑŒ AI-Ñ€ÐµÐ¶Ð¸Ð¼.');
    return;
  }

  if (!isPuterAnsweringAvailable()) {
    setStatus('error', 'Puter unavailable on this device right now.');
    return;
  }

  aiCreateBtn.disabled = true;
  submitBtn.disabled = true;
  reportIssueBtn.disabled = true;
  setStatus('loading', 'Puter Ð¾Ð±Ð¸Ñ€Ð°Ñ” Ð¿Ñ€Ð°Ð²Ð¸Ð»ÑŒÐ½Ñ– Ð²Ñ–Ð´Ð¿Ð¾Ð²Ñ–Ð´Ñ–.');

  try {
    const answeredPayload = await answerDraftWithPuter(currentDraftPayload);
    currentDraftToken = answeredPayload.draftToken;
    currentDraftPayload = answeredPayload;
    await finalizeCurrentDraft('');
  } catch (error) {
    setStatus('error', error.message || 'ÐÐµ Ð²Ð´Ð°Ð»Ð¾ÑÑ Ð¾Ð±Ñ€Ð¾Ð±Ð¸Ñ‚Ð¸ Ð²Ñ–Ð´Ð¿Ð¾Ð²Ñ–Ð´Ñ– Ñ‡ÐµÑ€ÐµÐ· Puter.');
  } finally {
    aiCreateBtn.disabled = false;
    submitBtn.disabled = false;
    reportIssueBtn.disabled = false;
  }
}

async function waitForAiPrepareJob(jobId) {
  for (;;) {
    await delay(1200);
    const response = await fetch(`/api/ai-quizzes/jobs/${encodeURIComponent(jobId)}`);
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.error || 'Не вдалося отримати статус AI-обробки.');
    }

    setStatus('loading', buildAiProgressStatus(payload));

    if (payload.status === 'completed') {
      currentAiJobId = '';
      return payload.result;
    }

    if (payload.status === 'failed') {
      currentAiJobId = '';
      throw new Error(payload.error || 'AI-обробка завершилась з помилкою.');
    }
  }
}

function buildAiProgressStatus(payload) {
  const percent = Math.max(0, Math.min(100, Number(payload?.progressPercent) || 0));
  const chunkIndex = Number(payload?.chunkIndex || 0);
  const chunkCount = Number(payload?.chunkCount || 0);
  const message = String(payload?.message || 'AI обробляє питання.');
  const chunkText = chunkCount > 1 && chunkIndex > 0 ? ` Блок ${chunkIndex}/${chunkCount}.` : '';
  return `${message} ${percent}%${chunkText}`.trim();
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return { error: text };
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function buildPuterAnswerMessagesOverride(batchQuestions, batchIndex, batchCount) {
  const compactQuestions = batchQuestions.map((question, index) => ({
    sourceQuestionNumber: Number(question.sourceQuestionNumber || index + 1),
    q: question.q,
    options: Array.isArray(question.options) ? question.options : [],
  }));

  return [{
    role: 'user',
    content: [
      'Ð¢Ð¸ Ð²Ð¸Ð·Ð½Ð°Ñ‡Ð°Ñ”Ñˆ Ð¿Ñ€Ð°Ð²Ð¸Ð»ÑŒÐ½Ñ– Ð²Ñ–Ð´Ð¿Ð¾Ð²Ñ–Ð´Ñ– Ð´Ð»Ñ Ð¼ÐµÐ´Ð¸Ñ‡Ð½Ð¾Ð³Ð¾ Ñ‚ÐµÑÑ‚Ñƒ.',
      'Ð”Ð»Ñ ÐºÐ¾Ð¶Ð½Ð¾Ð³Ð¾ Ð¿Ð¸Ñ‚Ð°Ð½Ð½Ñ Ð¿Ð¾Ð²ÐµÑ€Ð½Ð¸ Ñ–Ð½Ð´ÐµÐºÑ Ð¿Ñ€Ð°Ð²Ð¸Ð»ÑŒÐ½Ð¾Ñ— Ð²Ñ–Ð´Ð¿Ð¾Ð²Ñ–Ð´Ñ– correctIndex Ñƒ Ñ„Ð¾Ñ€Ð¼Ð°Ñ‚Ñ– 0-based.',
      'ÐÐµ Ð¿ÐµÑ€ÐµÐ¿Ð¸ÑÑƒÐ¹ Ñ‚ÐµÐºÑÑ‚ Ð¿Ð¸Ñ‚Ð°Ð½ÑŒ Ñ‡Ð¸ Ð²Ð°Ñ€Ñ–Ð°Ð½Ñ‚Ñ–Ð².',
      'ÐÐµ Ð¿Ñ€Ð¾Ð¿ÑƒÑÐºÐ°Ð¹ Ð¿Ð¸Ñ‚Ð°Ð½Ð½Ñ.',
      'ÐŸÐ¾Ð²ÐµÑ€Ð½Ð¸ Ñ‚Ñ–Ð»ÑŒÐºÐ¸ JSON Ð±ÐµÐ· markdown Ñƒ Ñ„Ð¾Ñ€Ð¼Ð°Ñ‚Ñ– {"answers":[{"sourceQuestionNumber":1,"correctIndex":0}]}.',
      `Ð‘Ð°Ñ‚Ñ‡ ${batchIndex + 1} Ð· ${batchCount}.`,
      `ÐŸÐ¸Ñ‚Ð°Ð½Ð½Ñ:\n${JSON.stringify(compactQuestions)}`,
    ].join('\n\n'),
  }];
}

async function requestPuterAnswerBatch(batchQuestions, batchIndex, batchCount) {
  const puterRequest = window.puter.ai.chat(buildPuterAnswerMessages(batchQuestions, batchIndex, batchCount), {
    model: adminBootstrap.puterAnswerModel,
  });
  const timeoutMs = 90000;
  const response = await Promise.race([
    puterRequest,
    new Promise((_, reject) => {
      window.setTimeout(() => {
        reject(new Error('Безкоштовний режим не отримав відповідь вчасно. Спробуйте ще раз або увійдіть у Puter.'));
      }, timeoutMs);
    }),
  ]);
  const rawText = extractPuterChatText(response);
  const parsed = parseJsonFromModelText(rawText);
  const answers = Array.isArray(parsed?.answers) ? parsed.answers : [];

  if (answers.length !== batchQuestions.length) {
    throw new Error(`Puter returned ${answers.length} answers for ${batchQuestions.length} questions.`);
  }

  return answers;
}

function normalizePuterAnsweredQuestions(questions, answers) {
  const answerMap = new Map();
  for (const answer of answers) {
    const questionNumber = Number(answer?.sourceQuestionNumber || 0);
    const correctIndex = Number(answer?.correctIndex);
    if (!Number.isInteger(questionNumber) || !Number.isInteger(correctIndex)) {
      throw new Error('Puter returned invalid answer data.');
    }
    answerMap.set(questionNumber, correctIndex);
  }

  return questions.map((question, index) => {
    const sourceQuestionNumber = Number(question?.sourceQuestionNumber || index + 1);
    const options = Array.isArray(question?.options) ? question.options : [];
    const correctIndex = answerMap.get(sourceQuestionNumber);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      throw new Error(`Puter returned an invalid correct answer for question ${sourceQuestionNumber}.`);
    }

    return {
      ...question,
      correctIndex,
    };
  });
}

async function answerDraftWithPuterOverride(payload) {
  const draftToken = String(payload?.draftToken || '').trim();
  const questions = Array.isArray(payload?.questions) ? payload.questions : [];
  if (!draftToken || !questions.length) {
    throw new Error('Ð§ÐµÑ€Ð½ÐµÑ‚ÐºÑƒ Ð´Ð»Ñ Puter Ð½Ðµ Ð·Ð½Ð°Ð¹Ð´ÐµÐ½Ð¾.');
  }

  const chunks = chunkQuestionsForRepair(questions, 25);
  const answers = [];

  for (let batchIndex = 0; batchIndex < chunks.length; batchIndex += 1) {
    setStatus('loading', `Puter Ð¾Ð±Ñ€Ð¾Ð±Ð»ÑÑ” Ð±Ð»Ð¾Ðº ${batchIndex + 1}/${chunks.length}.`);
    const batchAnswers = await requestPuterAnswerBatch(chunks[batchIndex], batchIndex, chunks.length);
    answers.push(...batchAnswers);
  }

  const answeredQuestions = normalizePuterAnsweredQuestions(questions, answers);
  const repairResponse = await fetch('/api/drafts/repair', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      draftToken,
      questions: answeredQuestions,
      reviewBlocks: Array.isArray(payload.reviewBlocks) ? payload.reviewBlocks : [],
      notes: ['ÐŸÑ€Ð°Ð²Ð¸Ð»ÑŒÐ½Ñ– Ð²Ñ–Ð´Ð¿Ð¾Ð²Ñ–Ð´Ñ– Ð²Ð¸Ð·Ð½Ð°Ñ‡ÐµÐ½Ñ– Ñ‡ÐµÑ€ÐµÐ· Puter.'],
      aiAnswering: {
        provider: 'puter',
        mode: 'puter',
        model: adminBootstrap.puterAnswerModel,
        requireCode: false,
        answerMode: 'puter-browser',
        batchCount: chunks.length,
      },
    }),
  });
  const repairPayload = await readJsonResponse(repairResponse);
  if (!repairResponse.ok) {
    throw new Error(repairPayload.error || 'Failed to save Puter answers.');
  }

  return {
    ...payload,
    draftToken,
    parsedCount: repairPayload.parsedCount || payload.parsedCount,
    notes: Array.isArray(repairPayload.notes) ? repairPayload.notes : payload.notes,
    questions: answeredQuestions,
    rawModelJson: repairPayload.rawModelJson || payload.rawModelJson || {},
  };
}

async function reportCurrentUploadIssue() {
  const sourceFile = sourceFileInput.files?.[0] || null;
  const answerFile = answerFileInput.files?.[0] || null;
  const title = String(clientTitleInput?.value || '').trim();

  if (!sourceFile && !answerFile) {
    setStatus('error', 'Спочатку виберіть файл, який треба відправити на перевірку.');
    return;
  }

  const note = window.prompt('Опишіть, що не так із файлом або чому тест не зібрався.', '');
  if (note === null) {
    return;
  }

  const normalizedNote = String(note || '').trim();
  if (!normalizedNote) {
    setStatus('error', 'Вкажіть причину репорту.');
    return;
  }

  reportIssueBtn.disabled = true;
  setStatus('loading', 'Надсилаю файл адміністратору на перевірку.');

  try {
    const formData = new FormData();
    if (title) {
      formData.append('title', title);
    }
    formData.append('note', normalizedNote);
    if (sourceFile) {
      formData.append('sourceFile', sourceFile);
    }
    if (answerFile) {
      formData.append('answerFile', answerFile);
    }

    const creatorProfile = await buildCreatorProfile();
    formData.append('pageUrl', window.location.href);
    formData.append('reporterProfileJson', JSON.stringify(creatorProfile));

    const response = await fetch('/api/reports/upload', {
      method: 'POST',
      body: formData,
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Не вдалося відправити репорт.');
    }

    setStatus('success', 'Файл відправлено.');
    resultBox.classList.remove('hidden');
    resultBox.innerHTML = `
      <h3>${escapeHtml(title || sourceFile?.name || answerFile?.name || 'Upload report')}</h3>
      <p>Репорт створено: <strong>${escapeHtml(String(payload.reportType || 'upload'))} ${escapeHtml(String(payload.reportId || ''))}</strong></p>
      <p>Файл збережено для окремого аналізу.</p>
    `;
  } catch (error) {
    setStatus('error', error.message || 'Не вдалося відправити репорт.');
  } finally {
    reportIssueBtn.disabled = false;
  }
}

function renderDraftResult(payload) {
  resultBox.classList.remove('hidden');

  const notes = Array.isArray(payload.notes) ? payload.notes.filter(Boolean) : [];
  const adminContact = String(payload.adminContactTg || '').trim();
  const notesHtml = notes.length
    ? `
      <div class="notes-box">
        <p><strong>Що помітив парсер</strong></p>
        ${notes.map((note) => `<p>${escapeHtml(note)}</p>`).join('')}
      </div>
    `
    : '';
  const adminContactHtml = adminContact
    ? `<p class="admin-contact">Зв'язок з адміністратором: <strong>${escapeHtml(adminContact)}</strong></p>`
    : '';

  resultBox.innerHTML = `
    <h3>${escapeHtml(payload.title)}</h3>
    <p>Питань знайдено: <strong>${escapeHtml(String(payload.parsedCount || 0))}</strong></p>
    ${adminContactHtml}
    ${notesHtml}
    <div class="activation-box">
      <p class="activation-text">Готую посилання...</p>
    </div>
  `;
}

function renderAiCodeGate(payload) {
  resultBox.classList.remove('hidden');

  const requiresCode = Boolean(payload.aiRequireCode);
  const puterAvailable = isPuterAnsweringAvailable();

  resultBox.innerHTML = `
    <h3>${escapeHtml(payload.title)}</h3>
    <div class="activation-box">
      <div style="margin-top:12px; display:grid; gap:10px;">
        <label class="choice-row">
          <input id="aiUsePuterCheckbox" type="checkbox" ${puterAvailable ? '' : 'disabled'} />
          <span>Безкоштовно${puterAvailable ? '' : ' (недоступно на цьому пристрої)'}</span>
        </label>
        <p style="margin:0; color:#6b7280; font-size:14px;">
          Якщо увімкнено, відповіді підбираються безкоштовно. Якщо вимкнено, використовується звичайний режим з кодом доступу.
        </p>
        <div id="aiCodeGateFields" style="display:grid; gap:10px;">
          <input id="aiAccessCodeInput" type="text" placeholder="Код доступу" autocomplete="off" />
          <button id="aiCheckCodeBtn" class="secondary-btn" type="button">Перевірити код</button>
          <p id="aiCodeMessage" style="margin:0; line-height:1.5;"></p>
        </div>
        <button id="aiFinalizeBtn" class="primary-btn ${requiresCode ? 'hidden' : ''}" type="button">Надіслати</button>
      </div>
    </div>
  `;

  const puterCheckbox = document.getElementById('aiUsePuterCheckbox');
  const codeGateFields = document.getElementById('aiCodeGateFields');
  const codeInput = document.getElementById('aiAccessCodeInput');
  const checkBtn = document.getElementById('aiCheckCodeBtn');
  const sendBtn = document.getElementById('aiFinalizeBtn');

  const syncAiGateMode = () => {
    const usePuter = Boolean(puterCheckbox?.checked);
    validatedAccessCode = '';
    validatedCodePayload = null;
    const messageBox = document.getElementById('aiCodeMessage');
    if (messageBox) {
      messageBox.textContent = '';
    }

    if (codeGateFields) {
      codeGateFields.style.display = usePuter ? 'none' : 'grid';
    }

    if (sendBtn) {
      const shouldShowSend = usePuter;
      sendBtn.classList.toggle('hidden', !shouldShowSend);
      sendBtn.disabled = false;
    }
  };

  codeInput?.addEventListener('input', () => {
    validatedAccessCode = '';
    validatedCodePayload = null;
    const messageBox = document.getElementById('aiCodeMessage');
    if (messageBox) {
      messageBox.textContent = '';
    }
    sendBtn?.classList.add('hidden');
    if (sendBtn) {
      sendBtn.disabled = true;
    }
  });
  puterCheckbox?.addEventListener('change', syncAiGateMode);
  codeInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      validateAiAccessCode();
    }
  });
  checkBtn?.addEventListener('click', validateAiAccessCode);
  sendBtn?.addEventListener('click', finalizeAiDraft);
  syncAiGateMode();
}

function isPuterAiModeSelected() {
  return Boolean(document.getElementById('aiUsePuterCheckbox')?.checked);
}

function buildCodeSuccessMessage(payload) {
  const parts = ['Код дійсний.'];
  if (payload.expectedQuestionCount) {
    parts.push(`Ліміт: ${payload.expectedQuestionCount} питань.`);
  }
  if (payload.siteTypeLabel) {
    parts.push(`Тип: ${payload.siteTypeLabel}.`);
  }
  return parts.join(' ');
}

async function finalizeCurrentDraft(accessCode = '') {
  if (!currentDraftToken) {
    throw new Error('Чернетку не знайдено. Передайте файл ще раз.');
  }

  const clientTgUsername = await ensureClientTgUsername();
  const response = await fetch('/api/quizzes/finalize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      draftToken: currentDraftToken,
      accessCode,
      clientTgUsername,
      creatorProfile: await buildCreatorProfile(),
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Не вдалося отримати посилання.');
  }

  currentDraftToken = '';
  currentDraftPayload = payload;
  validatedAccessCode = '';
  validatedCodePayload = null;
  rememberResolvedClientTgUsername(payload.clientTgUsername || clientTgUsername);
  setStatus('success', 'Посилання готове.');
  renderFinalResult(payload);
  return payload;
}

function renderFinalResult(payload) {
  resultBox.classList.remove('hidden');
  const disagreements = Array.isArray(payload.aiDisagreements) ? payload.aiDisagreements : [];
  const suspiciousQuestions = Array.isArray(payload.aiSuspiciousQuestions) ? payload.aiSuspiciousQuestions : [];
  const warningNumbers = Array.from(new Set([
    ...disagreements.map((item) => String(item.questionNumber || '?')),
    ...suspiciousQuestions.map((item) => String(item.questionNumber || '?')),
  ]));
  const disagreementHtml = warningNumbers.length
    ? `
      <div class="notes-box">
        <p><strong>Будь ласка, перевірте ще раз такі питання:</strong></p>
        <p>${escapeHtml(warningNumbers.join(', '))}</p>
      </div>
    `
    : '';

  resultBox.innerHTML = `
    <h3>${escapeHtml(payload.title)}</h3>
    ${disagreementHtml}
    <p>Питань знайдено: <strong>${escapeHtml(String(payload.parsedCount || 0))}</strong></p>
    <div id="quizLinkBox">
      <p><a href="${escapeAttr(String(payload.quizUrl || ''))}" target="_blank" rel="noreferrer">${escapeHtml(String(payload.quizUrl || ''))}</a></p>
    </div>
  `;
}

async function buildCreatorProfile() {
  const nav = window.navigator || {};
  const screenInfo = window.screen || {};
  const userAgentData = await readUserAgentData(nav.userAgentData);

  return {
    browserId: getOrCreateBrowserId(),
    capturedAt: Date.now(),
    pageUrl: window.location.href,
    referrer: document.referrer || '',
    language: nav.language || '',
    languages: Array.isArray(nav.languages) ? nav.languages.slice(0, 10) : [],
    timezone: getResolvedTimeZone(),
    locale: getResolvedLocale(),
    platform: nav.platform || '',
    vendor: nav.vendor || '',
    userAgent: nav.userAgent || '',
    cookieEnabled: typeof nav.cookieEnabled === 'boolean' ? nav.cookieEnabled : null,
    doNotTrack: nav.doNotTrack || '',
    webdriver: typeof nav.webdriver === 'boolean' ? nav.webdriver : null,
    hardwareConcurrency: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    deviceMemory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    maxTouchPoints: typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints : 0,
    deviceClass: detectDeviceClass({
      mobile: userAgentData?.mobile,
      maxTouchPoints: nav.maxTouchPoints,
      viewportWidth: window.innerWidth,
      userAgent: nav.userAgent || '',
    }),
    screen: {
      width: screenInfo.width || null,
      height: screenInfo.height || null,
      availWidth: screenInfo.availWidth || null,
      availHeight: screenInfo.availHeight || null,
      colorDepth: screenInfo.colorDepth || null,
      pixelDepth: screenInfo.pixelDepth || null,
    },
    viewport: {
      width: window.innerWidth || null,
      height: window.innerHeight || null,
      pixelRatio: window.devicePixelRatio || 1,
    },
    connection: readConnectionInfo(nav.connection),
    userAgentData,
  };
}

async function readUserAgentData(userAgentData) {
  if (!userAgentData) {
    return null;
  }

  let highEntropyValues = {};
  if (typeof userAgentData.getHighEntropyValues === 'function') {
    try {
      highEntropyValues = await userAgentData.getHighEntropyValues([
        'architecture',
        'bitness',
        'fullVersionList',
        'model',
        'platformVersion',
        'uaFullVersion',
        'wow64',
      ]);
    } catch {
      highEntropyValues = {};
    }
  }

  return {
    brands: Array.isArray(userAgentData.brands) ? userAgentData.brands : [],
    mobile: typeof userAgentData.mobile === 'boolean' ? userAgentData.mobile : null,
    platform: userAgentData.platform || '',
    architecture: highEntropyValues.architecture || '',
    bitness: highEntropyValues.bitness || '',
    fullVersionList: Array.isArray(highEntropyValues.fullVersionList) ? highEntropyValues.fullVersionList : [],
    model: highEntropyValues.model || '',
    platformVersion: highEntropyValues.platformVersion || '',
    uaFullVersion: highEntropyValues.uaFullVersion || '',
    wow64: typeof highEntropyValues.wow64 === 'boolean' ? highEntropyValues.wow64 : null,
  };
}

function readConnectionInfo(connection) {
  if (!connection) {
    return null;
  }

  return {
    effectiveType: connection.effectiveType || '',
    downlink: typeof connection.downlink === 'number' ? connection.downlink : null,
    rtt: typeof connection.rtt === 'number' ? connection.rtt : null,
    saveData: typeof connection.saveData === 'boolean' ? connection.saveData : null,
  };
}

function getOrCreateBrowserId() {
  const storageKey = 'pdmu_creator_browser_id';

  try {
    const storedValue = window.localStorage.getItem(storageKey);
    if (storedValue) {
      return storedValue;
    }

    const nextValue = typeof window.crypto?.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(storageKey, nextValue);
    return nextValue;
  } catch {
    return typeof window.crypto?.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

async function loadDeviceWarning() {
  if (!deviceWarningModal || !deviceWarningModalText || !deviceWarningModalTime) {
    return;
  }

  try {
    const response = await fetch('/api/device-warning');
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load device warning.');
    }

    const warning = payload.warning && typeof payload.warning === 'object' ? payload.warning : null;
    if (!warning || !String(warning.reason || '').trim()) {
      activeDeviceWarningSignature = '';
      closeDeviceWarningModal();
      deviceWarningModalText.textContent = '';
      deviceWarningModalTime.textContent = '';
      return;
    }

    activeDeviceWarningSignature = buildDeviceWarningSignature(warning);
    deviceWarningModalText.textContent = String(warning.reason || '').trim();
    deviceWarningModalTime.textContent = Number(warning.createdAt || 0) > 0 ? formatNoticeDateTime(Number(warning.createdAt || 0)) : '';
    if (isDeviceWarningDismissed(activeDeviceWarningSignature)) {
      closeDeviceWarningModal();
      return;
    }

    openDeviceWarningModal();
  } catch (_error) {
    closeDeviceWarningModal();
  }
}

function buildDeviceWarningSignature(warning) {
  if (!warning || typeof warning !== 'object') {
    return '';
  }

  return [
    String(warning.deviceId || '').trim(),
    String(warning.createdAt || '').trim(),
    String(warning.reason || '').trim(),
  ].join('::');
}

function isDeviceWarningDismissed(signature) {
  if (!signature) {
    return false;
  }

  try {
    return window.localStorage.getItem('pdmu_device_warning_dismissed') === signature;
  } catch {
    return false;
  }
}

function markDeviceWarningDismissed(signature) {
  if (!signature) {
    return;
  }

  try {
    window.localStorage.setItem('pdmu_device_warning_dismissed', signature);
  } catch {
    // Ignore storage failures.
  }
}

function openDeviceWarningModal() {
  if (!deviceWarningModal) {
    return;
  }

  deviceWarningModal.classList.remove('hidden');
  deviceWarningModal.setAttribute('aria-hidden', 'false');
}

function closeDeviceWarningModal() {
  if (!deviceWarningModal) {
    return;
  }

  if (activeDeviceWarningSignature) {
    markDeviceWarningDismissed(activeDeviceWarningSignature);
  }
  deviceWarningModal.classList.add('hidden');
  deviceWarningModal.setAttribute('aria-hidden', 'true');
}

function syncBrowserIdCookie() {
  const browserId = getOrCreateBrowserId();
  if (!browserId) {
    return;
  }

  document.cookie = [
    `pdmu_browser_id=${encodeURIComponent(browserId)}`,
    'Path=/',
    `Max-Age=${60 * 60 * 24 * 365}`,
    'SameSite=Lax',
  ].join('; ');
}

function getResolvedTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

function getResolvedLocale() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || '';
  } catch {
    return '';
  }
}

function detectDeviceClass({ mobile, maxTouchPoints, viewportWidth, userAgent }) {
  if (mobile) {
    return 'mobile';
  }

  if (/ipad|tablet/i.test(String(userAgent || ''))) {
    return 'tablet';
  }

  if (/mobile|android|iphone/i.test(String(userAgent || ''))) {
    return 'mobile';
  }

  if (Number(maxTouchPoints || 0) > 1) {
    return Number(viewportWidth || 0) <= 900 ? 'mobile' : 'tablet';
  }

  return 'desktop';
}

function isAutoOptionCountEnabled() {
  return Boolean(optionCountAutoInput?.checked);
}

function getOptionCountRequestValue() {
  if (isAutoOptionCountEnabled()) {
    return 'auto';
  }

  return String(optionCountInput.value || 5);
}

function syncOptionCountMode() {
  if (!optionCountInput) {
    return;
  }

  const useAuto = isAutoOptionCountEnabled();
  optionCountInput.disabled = useAuto;
  optionCountInput.required = !useAuto;
  syncAnswerIndexOptions();
}

function syncAnswerIndexOptions() {
  const optionCount = isAutoOptionCountEnabled()
    ? 6
    : Math.max(2, Math.min(6, Number(optionCountInput.value || 5)));
  const previousValue = Math.max(1, Number(answerIndexSelect.value || 1));
  const selectedValue = Math.min(previousValue, optionCount);

  answerIndexSelect.innerHTML = '';

  for (let index = 1; index <= optionCount; index += 1) {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = String(index);
    option.selected = index === selectedValue;
    answerIndexSelect.appendChild(option);
  }
}

function syncAnswerMode() {
  const useFile = getAnswerMode() === 'file';

  singleAnswerField.classList.toggle('hidden', useFile);
  answerFileField.classList.toggle('hidden', !useFile);
  answerIndexSelect.disabled = useFile;
  answerFileInput.disabled = !useFile;
  answerFileInput.required = useFile;
  answerFileInput.setAttribute('title', 'Підтримуються .txt, .pdf, .doc, .docx');
}

function getAnswerMode() {
  return answerModeFileInput.checked ? 'file' : 'single';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

// Re-declare Puter/free-mode helpers at the end of the file to override
// mojibake-tainted strings introduced by a previous edit without touching
// unrelated legacy UI strings in this file.
function buildPuterAnswerMessages(batchQuestions, batchIndex, batchCount) {
  const compactQuestions = batchQuestions.map((question, index) => ({
    sourceQuestionNumber: Number(question.sourceQuestionNumber || index + 1),
    q: question.q,
    options: Array.isArray(question.options) ? question.options : [],
  }));

  return [{
    role: 'user',
    content: [
      'Ти визначаєш правильні відповіді для медичного тесту.',
      'Для кожного питання поверни індекс правильної відповіді correctIndex у форматі 0-based.',
      'Не переписуй текст питань чи варіантів.',
      'Не пропускай питання.',
      'Поверни тільки JSON без markdown у форматі {"answers":[{"sourceQuestionNumber":1,"correctIndex":0}]}.',
      `Батч ${batchIndex + 1} з ${batchCount}.`,
      `Питання:\n${JSON.stringify(compactQuestions)}`,
    ].join('\n\n'),
  }];
}

async function answerDraftWithPuter(payload) {
  const draftToken = String(payload?.draftToken || '').trim();
  const questions = Array.isArray(payload?.questions) ? payload.questions : [];
  if (!draftToken || !questions.length) {
    throw new Error('Чернетку для безкоштовного режиму не знайдено.');
  }

  const chunks = chunkQuestionsForRepair(questions, 25);
  const answers = [];

  for (let batchIndex = 0; batchIndex < chunks.length; batchIndex += 1) {
    setStatus('loading', `Безкоштовний режим обробляє блок ${batchIndex + 1}/${chunks.length}.`);
    const batchAnswers = await requestPuterAnswerBatch(chunks[batchIndex], batchIndex, chunks.length);
    answers.push(...batchAnswers);
  }

  const answeredQuestions = normalizePuterAnsweredQuestions(questions, answers);
  const repairResponse = await fetch('/api/drafts/repair', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      draftToken,
      questions: answeredQuestions,
      reviewBlocks: Array.isArray(payload.reviewBlocks) ? payload.reviewBlocks : [],
      notes: ['Правильні відповіді визначені у безкоштовному режимі.'],
      aiAnswering: {
        provider: 'puter',
        mode: 'puter',
        model: adminBootstrap.puterAnswerModel,
        requireCode: false,
        answerMode: 'puter-browser',
        batchCount: chunks.length,
      },
    }),
  });
  const repairPayload = await readJsonResponse(repairResponse);
  if (!repairResponse.ok) {
    throw new Error(repairPayload.error || 'Failed to save free-mode answers.');
  }

  return {
    ...payload,
    draftToken,
    parsedCount: repairPayload.parsedCount || payload.parsedCount,
    notes: Array.isArray(repairPayload.notes) ? repairPayload.notes : payload.notes,
    questions: answeredQuestions,
    rawModelJson: repairPayload.rawModelJson || payload.rawModelJson || {},
  };
}

async function finalizePuterAiDraftOverride() {
  if (!currentDraftPayload?.draftToken || !Array.isArray(currentDraftPayload?.questions) || !currentDraftPayload.questions.length) {
    setStatus('error', 'Спочатку запустіть AI-режим.');
    return;
  }

  if (!isPuterAnsweringAvailable()) {
    setStatus('error', 'Безкоштовний режим недоступний на цьому пристрої.');
    return;
  }

  aiCreateBtn.disabled = true;
  submitBtn.disabled = true;
  reportIssueBtn.disabled = true;
  setStatus('loading', 'Безкоштовний режим підбирає правильні відповіді.');

  try {
    const answeredPayload = await answerDraftWithPuterOverride(currentDraftPayload);
    currentDraftToken = answeredPayload.draftToken;
    currentDraftPayload = answeredPayload;
    await finalizeCurrentDraft('');
  } catch (error) {
    setStatus('error', error.message || 'Не вдалося обробити відповіді у безкоштовному режимі.');
  } finally {
    aiCreateBtn.disabled = false;
    submitBtn.disabled = false;
    reportIssueBtn.disabled = false;
  }
}

function renderAiCodeGateOverride(payload) {
  resultBox.classList.remove('hidden');

  const requiresCode = Boolean(payload.aiRequireCode);
  const puterAvailable = isPuterAnsweringAvailable();

  resultBox.innerHTML = `
    <h3>${escapeHtml(payload.title)}</h3>
    <div class="activation-box">
      <div style="margin-top:12px; display:grid; gap:10px;">
        <label class="choice-row">
          <input id="aiUsePuterCheckbox" type="checkbox" ${puterAvailable ? '' : 'disabled'} />
          <span>Безкоштовно${puterAvailable ? '' : ' (недоступно на цьому пристрої)'}</span>
        </label>
        <p style="margin:0; color:#6b7280; font-size:14px;">
          Якщо увімкнено, відповіді підбираються безкоштовно. Якщо вимкнено, використовується звичайний режим з кодом доступу.
        </p>
        <div id="aiCodeGateFields" style="display:grid; gap:10px;">
          <input id="aiAccessCodeInput" type="text" placeholder="Код доступу" autocomplete="off" />
          <button id="aiCheckCodeBtn" class="secondary-btn" type="button">Перевірити код</button>
          <p id="aiCodeMessage" style="margin:0; line-height:1.5;"></p>
        </div>
        <button id="aiFinalizeBtn" class="primary-btn ${requiresCode ? 'hidden' : ''}" type="button">Надіслати</button>
      </div>
    </div>
  `;

  const puterCheckbox = document.getElementById('aiUsePuterCheckbox');
  const codeGateFields = document.getElementById('aiCodeGateFields');
  const codeInput = document.getElementById('aiAccessCodeInput');
  const checkBtn = document.getElementById('aiCheckCodeBtn');
  const sendBtn = document.getElementById('aiFinalizeBtn');

  const syncAiGateMode = () => {
    const usePuter = Boolean(puterCheckbox?.checked);
    validatedAccessCode = '';
    validatedCodePayload = null;
    const messageBox = document.getElementById('aiCodeMessage');
    if (messageBox) {
      messageBox.textContent = '';
    }

    if (codeGateFields) {
      codeGateFields.style.display = usePuter ? 'none' : 'grid';
    }

    if (sendBtn) {
      const shouldShowSend = usePuter;
      sendBtn.classList.toggle('hidden', !shouldShowSend);
      sendBtn.disabled = false;
    }
  };

  codeInput?.addEventListener('input', () => {
    validatedAccessCode = '';
    validatedCodePayload = null;
    const messageBox = document.getElementById('aiCodeMessage');
    if (messageBox) {
      messageBox.textContent = '';
    }
    sendBtn?.classList.add('hidden');
    if (sendBtn) {
      sendBtn.disabled = true;
    }
  });
  puterCheckbox?.addEventListener('change', syncAiGateMode);
  codeInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      validateAiAccessCode();
    }
  });
  checkBtn?.addEventListener('click', validateAiAccessCode);
  sendBtn?.addEventListener('click', finalizeAiDraft);
  syncAiGateMode();
}

buildPuterAnswerMessages = buildPuterAnswerMessagesOverride;
answerDraftWithPuter = answerDraftWithPuterOverride;
finalizePuterAiDraft = finalizePuterAiDraftOverride;
renderAiCodeGate = renderAiCodeGateOverride;
