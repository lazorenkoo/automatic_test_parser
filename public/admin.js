const quizForm = document.getElementById('quizForm');
const submitBtn = document.getElementById('submitBtn');
const statusBox = document.getElementById('statusBox');
const resultBox = document.getElementById('resultBox');
const answerIndexSelect = document.getElementById('answerIndex');
const optionCountInput = document.getElementById('optionCount');
const useAllQuestionsInput = document.getElementById('useAllQuestions');
const questionLimitField = document.getElementById('questionLimitField');
const questionLimitInput = document.getElementById('questionLimit');

let currentDraftToken = '';
let currentDraftPayload = null;

syncAnswerIndexOptions();
syncQuestionLimitMode();

optionCountInput.addEventListener('input', syncAnswerIndexOptions);
useAllQuestionsInput.addEventListener('change', syncQuestionLimitMode);

quizForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  setStatus('loading', 'Файл распознается локальным парсером. Это может занять немного времени.');
  resultBox.classList.add('hidden');
  resultBox.innerHTML = '';
  submitBtn.disabled = true;
  currentDraftToken = '';
  currentDraftPayload = null;

  try {
    const formData = new FormData();
    const sourceFile = document.getElementById('sourceFile').files?.[0];

    if (!sourceFile) {
      throw new Error('Сначала выберите файл.');
    }

    formData.append('sourceFile', sourceFile);
    formData.append('answerIndex', answerIndexSelect.value);
    formData.append('optionCount', optionCountInput.value);
    formData.append('questionMode', useAllQuestionsInput.checked ? 'all' : 'manual');

    if (!useAllQuestionsInput.checked) {
      formData.append('questionLimit', questionLimitInput.value);
    }

    const response = await fetch('/api/parse', {
      method: 'POST',
      body: formData,
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Не удалось распарсить файл.');
    }

    currentDraftToken = payload.draftToken;
    currentDraftPayload = payload;
    setStatus('success', 'Тест готов.');
    renderDraftResult(payload);
  } catch (error) {
    setStatus('error', error.message || 'Произошла ошибка.');
  } finally {
    submitBtn.disabled = false;
  }
});

function setStatus(kind, message) {
  statusBox.className = `status ${kind}`;
  statusBox.textContent = message;
}

function renderDraftResult(payload) {
  resultBox.classList.remove('hidden');

  const notesHtml = Array.isArray(payload.notes) && payload.notes.length
    ? `
      <div class="notes-box">
        ${payload.notes.map((note) => `<p>${escapeHtml(note)}</p>`).join('')}
      </div>
    `
    : '';

  resultBox.innerHTML = `
    <h3>${escapeHtml(payload.title)}</h3>
    <p>Вопросов найдено: <strong>${payload.parsedCount}</strong></p>
    ${notesHtml}
    <div class="activation-box">
      <p class="activation-text">Введите одноразовый код, чтобы открыть доступ к готовой ссылке.</p>
      <form id="accessForm" class="access-form">
        <label class="field">
          <span>Одноразовый код</span>
          <input id="accessCode" name="accessCode" type="password" placeholder="Например: ABCD-EFGH-JKLM" required />
        </label>
        <button id="activateBtn" class="secondary-btn" type="submit">Получить ссылку</button>
      </form>
    </div>
  `;

  const accessForm = document.getElementById('accessForm');
  accessForm?.addEventListener('submit', handleFinalizeSubmit);
}

async function handleFinalizeSubmit(event) {
  event.preventDefault();

  if (!currentDraftToken) {
    setStatus('error', 'Черновик не найден. Распарсите файл заново.');
    return;
  }

  const accessCodeInput = document.getElementById('accessCode');
  const activateBtn = document.getElementById('activateBtn');

  setStatus('loading', 'Проверяю код и готовлю ссылку.');
  activateBtn.disabled = true;

  try {
    const response = await fetch('/api/quizzes/finalize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        draftToken: currentDraftToken,
        accessCode: accessCodeInput?.value || '',
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Не удалось получить ссылку.');
    }

    currentDraftToken = '';
    setStatus('success', 'Ссылка готова.');
    renderFinalResult(payload, currentDraftPayload);
  } catch (error) {
    setStatus('error', error.message || 'Произошла ошибка.');
    activateBtn.disabled = false;
  }
}

function renderFinalResult(payload, draftPayload) {
  resultBox.classList.remove('hidden');
  resultBox.innerHTML = `
    <h3>${escapeHtml(payload.title)}</h3>
    <p>Вопросов найдено: <strong>${payload.parsedCount}</strong></p>
    <div class="warning-box">
      <p class="warning-text">ВНИМАНИЕ: если по этой ссылке будет вход более чем с 3 устройств, ссылка будет удалена.</p>
      <button id="revealQuizLinkBtn" class="primary-btn warning-btn" type="button">Понятно</button>
    </div>
    <div id="quizLinkBox" class="hidden">
      <p><a href="${escapeAttr(payload.quizUrl)}" target="_blank" rel="noreferrer">${escapeHtml(payload.quizUrl)}</a></p>
    </div>
  `;

  const revealButton = document.getElementById('revealQuizLinkBtn');
  const quizLinkBox = document.getElementById('quizLinkBox');

  revealButton?.addEventListener('click', () => {
    quizLinkBox?.classList.remove('hidden');
    revealButton.remove();
  });
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
