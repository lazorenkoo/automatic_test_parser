const quizForm = document.getElementById('quizForm');
const submitBtn = document.getElementById('submitBtn');
const statusBox = document.getElementById('statusBox');
const resultBox = document.getElementById('resultBox');
const clientTitleInput = document.getElementById('clientTitle');
const sourceFileInput = document.getElementById('sourceFile');
const answerFileInput = document.getElementById('answerFile');
const answerIndexSelect = document.getElementById('answerIndex');
const optionCountInput = document.getElementById('optionCount');
const useAllQuestionsInput = document.getElementById('useAllQuestions');
const questionLimitField = document.getElementById('questionLimitField');
const questionLimitInput = document.getElementById('questionLimit');
const answerModeSingleInput = document.getElementById('answerModeSingle');
const answerModeFileInput = document.getElementById('answerModeFile');
const singleAnswerField = document.getElementById('singleAnswerField');
const answerFileField = document.getElementById('answerFileField');
const aiCreateBtn = document.getElementById('aiCreateBtn');
const reportIssueBtn = document.getElementById('reportIssueBtn');

let currentDraftToken = '';
let currentDraftPayload = null;
let validatedAccessCode = '';
let validatedCodePayload = null;

syncAnswerIndexOptions();
syncQuestionLimitMode();
syncAnswerMode();
syncReportButtonVisibility();

optionCountInput.addEventListener('input', syncAnswerIndexOptions);
useAllQuestionsInput.addEventListener('change', syncQuestionLimitMode);
answerModeSingleInput.addEventListener('change', syncAnswerMode);
answerModeFileInput.addEventListener('change', syncAnswerMode);
sourceFileInput.addEventListener('change', syncReportButtonVisibility);
answerFileInput.addEventListener('change', syncReportButtonVisibility);
aiCreateBtn?.addEventListener('click', prepareAiQuiz);
reportIssueBtn?.addEventListener('click', reportCurrentUploadIssue);

quizForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  setStatus('loading', '???? ???????????? ????????? ????????. ?? ???? ??????? ????? ????.');
  clearResultState();
  submitBtn.disabled = true;

  try {
    const clientTitle = String(clientTitleInput?.value || '').trim();
    const sourceFile = sourceFileInput.files?.[0];
    const answerMode = getAnswerMode();

    if (!clientTitle) {
      throw new Error('???????? ??????? ????? ?????.');
    }

    if (!sourceFile) {
      throw new Error('???????? ???????? ???? ?? ???????.');
    }

    const formData = new FormData();
    formData.append('clientTitle', clientTitle);
    formData.append('sourceFile', sourceFile);
    formData.append('optionCount', String(optionCountInput.value || 5));
    formData.append('questionMode', useAllQuestionsInput.checked ? 'all' : 'manual');
    formData.append('answerMode', answerMode);

    if (answerMode === 'single') {
      formData.append('answerIndex', String(answerIndexSelect.value || 1));
    } else {
      const answerFile = answerFileInput.files?.[0];
      if (!answerFile) {
        throw new Error('???????? ??????????? ??????? ???? ?? ???????????.');
      }
      formData.append('answerFile', answerFile);
    }

    if (!useAllQuestionsInput.checked) {
      formData.append('questionLimit', String(questionLimitInput.value || ''));
    }

    const response = await fetch('/api/parse', {
      method: 'POST',
      body: formData,
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || '?? ??????? ???????? ????.');
    }

    currentDraftToken = payload.draftToken;
    currentDraftPayload = payload;
    setStatus('success', '???? ???????.');
    renderDraftResult(payload);
    await finalizeCurrentDraft('');
  } catch (error) {
    setStatus('error', error.message || '?? ??????? ???????? ????.');
  } finally {
    submitBtn.disabled = false;
  }
});

function setStatus(kind, message) {
  statusBox.className = `status ${kind}`;
  statusBox.textContent = message;
}

function clearResultState() {
  currentDraftToken = '';
  currentDraftPayload = null;
  validatedAccessCode = '';
  validatedCodePayload = null;
  resultBox.classList.add('hidden');
  resultBox.innerHTML = '';
}

function syncReportButtonVisibility() {
  if (!reportIssueBtn && !aiCreateBtn) {
    return;
  }

  const hasFile = Boolean(sourceFileInput.files?.[0] || answerFileInput.files?.[0]);
  reportIssueBtn.classList.toggle('hidden', !hasFile);
  aiCreateBtn?.classList.toggle('hidden', !hasFile);
}

async function prepareAiQuiz() {
  const clientTitle = String(clientTitleInput?.value || '').trim();
  const sourceFile = sourceFileInput.files?.[0] || null;

  if (!clientTitle) {
    setStatus('error', 'Enter a test title first.');
    return;
  }

  if (!sourceFile) {
    setStatus('error', 'Attach a source file first.');
    return;
  }

  clearResultState();
  currentDraftPayload = {
    title: clientTitle,
    adminContactTg: '',
  };
  setStatus('success', 'Enter a code first. AI will start only after the code is confirmed.');
  renderAiCodeGate(currentDraftPayload);
}

async function validateAiAccessCode() {
  if (!currentDraftPayload) {
    setStatus('error', 'Start AI mode first.');
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
      messageBox.textContent = 'Enter an access code.';
    }
    setStatus('error', 'Enter an access code.');
    return;
  }

  if (messageBox) {
    messageBox.textContent = 'Checking code...';
  }

  try {
    const response = await fetch('/api/access-codes/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        accessCode: code,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Code validation failed.');
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
    setStatus('success', 'Code confirmed. AI can start now.');
  } catch (error) {
    if (messageBox) {
      messageBox.textContent = error.message || 'Code validation failed.';
    }
    setStatus('error', error.message || 'Code validation failed.');
  }
}

async function finalizeAiDraft() {
  if (!validatedAccessCode) {
    setStatus('error', 'Confirm the access code first.');
    return;
  }

  const sendBtn = document.getElementById('aiFinalizeBtn');
  const checkBtn = document.getElementById('aiCheckCodeBtn');
  const codeInput = document.getElementById('aiAccessCodeInput');
  const clientTitle = String(clientTitleInput?.value || '').trim();
  const sourceFile = sourceFileInput.files?.[0] || null;

  if (!clientTitle) {
    setStatus('error', 'Enter a test title first.');
    return;
  }

  if (!sourceFile) {
    setStatus('error', 'Attach a source file first.');
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
  setStatus('loading', 'Parsing file and running AI after confirmed code.');

  try {
    const formData = new FormData();
    formData.append('clientTitle', clientTitle);
    formData.append('sourceFile', sourceFile);
    formData.append('optionCount', String(optionCountInput.value || 5));
    formData.append('questionMode', useAllQuestionsInput.checked ? 'all' : 'manual');
    formData.append('accessCode', validatedAccessCode);
    if (!useAllQuestionsInput.checked) {
      formData.append('questionLimit', String(questionLimitInput.value || ''));
    }

    const prepareResponse = await fetch('/api/ai-quizzes/prepare', {
      method: 'POST',
      body: formData,
    });
    const preparePayload = await prepareResponse.json();
    if (!prepareResponse.ok) {
      throw new Error(preparePayload.error || 'Failed to prepare AI quiz.');
    }

    currentDraftToken = preparePayload.draftToken;
    currentDraftPayload = preparePayload;
    await finalizeCurrentDraft(validatedAccessCode);
  } catch (error) {
    setStatus('error', error.message || 'Failed to create the AI quiz.');
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

async function reportCurrentUploadIssue() {
  const sourceFile = sourceFileInput.files?.[0] || null;
  const answerFile = answerFileInput.files?.[0] || null;
  const title = String(clientTitleInput?.value || '').trim();

  if (!sourceFile && !answerFile) {
    setStatus('error', '???????? ???????? ????, ???? ????? ?????????? ?? ?????????.');
    return;
  }

  const note = window.prompt('???????, ?? ?? ??? ?? ?????? ??? ???? ???? ?? ????????.', '') || '';
  reportIssueBtn.disabled = true;
  setStatus('loading', '???????? ???? ?????????????? ?? ?????????.');

  try {
    const formData = new FormData();
    if (title) {
      formData.append('title', title);
    }
    if (note.trim()) {
      formData.append('note', note.trim());
    }
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
      throw new Error(payload.error || '?? ??????? ?????????? ??????.');
    }

    setStatus('success', '???? ???????????.');
    resultBox.classList.remove('hidden');
    resultBox.innerHTML = `
      <h3>${escapeHtml(title || sourceFile?.name || answerFile?.name || 'Upload report')}</h3>
      <p>?????? ????????: <strong>${escapeHtml(String(payload.reportType || 'upload'))} ${escapeHtml(String(payload.reportId || ''))}</strong></p>
      <p>???? ????????? ??? ???????? ???????.</p>
    `;
  } catch (error) {
    setStatus('error', error.message || '?? ??????? ?????????? ??????.');
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
        <p><strong>?? ??????? ??????</strong></p>
        ${notes.map((note) => `<p>${escapeHtml(note)}</p>`).join('')}
      </div>
    `
    : '';
  const adminContactHtml = adminContact
    ? `<p class="admin-contact">??'???? ? ???????????????: <strong>${escapeHtml(adminContact)}</strong></p>`
    : '';

  resultBox.innerHTML = `
    <h3>${escapeHtml(payload.title)}</h3>
    <p>?????? ????????: <strong>${escapeHtml(String(payload.parsedCount || 0))}</strong></p>
    ${adminContactHtml}
    ${notesHtml}
    <div class="activation-box">
      <p class="activation-text">????? ?????????...</p>
    </div>
  `;
}

function renderAiCodeGate(payload) {
  resultBox.classList.remove('hidden');

  const adminContact = String(payload.adminContactTg || '').trim();
  const adminContactHtml = adminContact
    ? `<p class="admin-contact">Admin contact: <strong>${escapeHtml(adminContact)}</strong></p>`
    : '';

  resultBox.innerHTML = `
    <h3>${escapeHtml(payload.title)}</h3>
    ${adminContactHtml}
    <div class="activation-box">
      <p class="activation-text">AI will not start until the access code is confirmed.</p>
      <div style="margin-top:12px; display:grid; gap:10px;">
        <input id="aiAccessCodeInput" type="text" placeholder="Access code" autocomplete="off" />
        <button id="aiCheckCodeBtn" class="secondary-btn" type="button">Check code</button>
        <p id="aiCodeMessage" style="margin:0; line-height:1.5;"></p>
        <button id="aiFinalizeBtn" class="primary-btn hidden" type="button">Send</button>
      </div>
    </div>
  `;

  const codeInput = document.getElementById('aiAccessCodeInput');
  const checkBtn = document.getElementById('aiCheckCodeBtn');
  const sendBtn = document.getElementById('aiFinalizeBtn');

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
  codeInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      validateAiAccessCode();
    }
  });
  checkBtn?.addEventListener('click', validateAiAccessCode);
  sendBtn?.addEventListener('click', finalizeAiDraft);
}

function buildCodeSuccessMessage(payload) {
  const parts = ['Code is valid.'];
  if (payload.expectedQuestionCount) {
    parts.push(`Limit: ${payload.expectedQuestionCount} questions.`);
  }
  if (payload.siteTypeLabel) {
    parts.push(`Type: ${payload.siteTypeLabel}.`);
  }
  return parts.join(' ');
}

async function finalizeCurrentDraft(accessCode = '') {
  if (!currentDraftToken) {
    throw new Error('???????? ?? ????????. ????????? ???? ?? ???.');
  }

  const response = await fetch('/api/quizzes/finalize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      draftToken: currentDraftToken,
      accessCode,
      creatorProfile: await buildCreatorProfile(),
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || '?? ??????? ???????? ?????????.');
  }

  currentDraftToken = '';
  currentDraftPayload = payload;
  validatedAccessCode = '';
  validatedCodePayload = null;
  setStatus('success', '????????? ??????.');
  renderFinalResult(payload);
  return payload;
}

function renderFinalResult(payload) {
  resultBox.classList.remove('hidden');

  resultBox.innerHTML = `
    <h3>${escapeHtml(payload.title)}</h3>
    <p>?????? ????????: <strong>${escapeHtml(String(payload.parsedCount || 0))}</strong></p>
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

function syncAnswerIndexOptions() {
  const optionCount = Math.max(2, Math.min(10, Number(optionCountInput.value || 5)));
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

function syncQuestionLimitMode() {
  const useAll = useAllQuestionsInput.checked;
  questionLimitField.classList.toggle('hidden', useAll);
  questionLimitInput.disabled = useAll;
  questionLimitInput.required = !useAll;

  if (!useAll && !questionLimitInput.value) {
    questionLimitInput.value = '20';
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
