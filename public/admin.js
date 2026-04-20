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

let currentDraftToken = '';
let currentDraftPayload = null;

syncAnswerIndexOptions();
syncQuestionLimitMode();
syncAnswerMode();

optionCountInput.addEventListener('input', syncAnswerIndexOptions);
useAllQuestionsInput.addEventListener('change', syncQuestionLimitMode);
answerModeSingleInput.addEventListener('change', syncAnswerMode);
answerModeFileInput.addEventListener('change', syncAnswerMode);

quizForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  setStatus('loading', 'Файл обробляється локальним парсером. Це може зайняти трохи часу.');
  resultBox.classList.add('hidden');
  resultBox.innerHTML = '';
  submitBtn.disabled = true;
  currentDraftToken = '';
  currentDraftPayload = null;

  try {
    const clientTitle = String(clientTitleInput?.value || '').trim();
    const sourceFile = sourceFileInput.files?.[0];
    const answerMode = getAnswerMode();

    if (!clientTitle) {
      throw new Error('Спочатку введіть назву тесту.');
    }

    if (!sourceFile) {
      throw new Error('Спочатку виберіть файл із тестами.');
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
        throw new Error('Потрібно завантажити окремий файл із відповідями.');
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
      throw new Error(payload.error || 'Не вдалося обробити файл.');
    }

    currentDraftToken = payload.draftToken;
    currentDraftPayload = payload;
    setStatus('success', 'Тест готовий.');
    renderDraftResult(payload);
    await finalizeCurrentDraft();
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

async function finalizeCurrentDraft() {
  if (!currentDraftToken) {
    setStatus('error', 'Чернетку не знайдено. Передайте файл ще раз.');
    return;
  }

  setStatus('loading', 'Готую посилання.');

  try {
    const response = await fetch('/api/quizzes/finalize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        draftToken: currentDraftToken,
        accessCode: '',
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Не вдалося отримати посилання.');
    }

    currentDraftToken = '';
    currentDraftPayload = payload;
    setStatus('success', 'Посилання готове.');
    renderFinalResult(payload);
  } catch (error) {
    setStatus('error', error.message || 'Не вдалося отримати посилання.');
  }
}

function renderFinalResult(payload) {
  resultBox.classList.remove('hidden');

  resultBox.innerHTML = `
    <h3>${escapeHtml(payload.title)}</h3>
    <p>Питань знайдено: <strong>${escapeHtml(String(payload.parsedCount || 0))}</strong></p>
    <div id="quizLinkBox">
      <p><a href="${escapeAttr(String(payload.quizUrl || ''))}" target="_blank" rel="noreferrer">${escapeHtml(String(payload.quizUrl || ''))}</a></p>
    </div>
  `;
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
