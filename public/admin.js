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
const langRuBtn = document.getElementById('langRuBtn');
const langUkBtn = document.getElementById('langUkBtn');

const LANGUAGE_STORAGE_KEY = 'pdmu-ui-language';

const translations = {
  ru: {
    pageTitle: 'PDMU Quiz Builder',
    'form.title': 'Создать тест',
    'form.client_title': 'Название теста',
    'form.source_file': 'Файл с тестами',
    'form.option_count': 'Вариантов ответа в вопросе',
    'form.answer_mode': 'Режим правильных ответов',
    'form.answer_mode_single': 'Один и тот же вариант для всех',
    'form.answer_mode_file': 'Отдельный файл с ответами',
    'form.answer_index': 'Правильный вариант',
    'form.answer_file': 'Файл с ответами',
    'form.question_count': 'Количество вопросов',
    'form.use_all_questions': 'Все вопросы',
    'form.question_limit': 'Сколько вопросов взять',
    'form.submit': 'Передать файл',
    'result.title': 'Результат',
    'status.idle': 'Ожидаю загрузку файла.',
    answerFilePlaceholder: 'Поддерживаются .txt, .pdf, .doc, .docx',
    accessTitle: 'Введите код доступа',
    accessText: 'Введите одноразовый код, чтобы получить доступ к готовой ссылке.',
    accessLabel: 'Одноразовый код',
    accessPlaceholder: 'Например: ABCD-EFGH-JKLM',
    accessButton: 'Получить ссылку',
    parseLoading: 'Файл обрабатывается локальным парсером. Это может занять немного времени.',
    parseSuccess: 'Тест готов.',
    finalizeLoading: 'Проверяю код и готовлю ссылку.',
    finalizeSuccess: 'Ссылка готова.',
    clientTitleRequiredError: 'Сначала введите название теста.',
    chooseFileError: 'Сначала выберите файл с тестами.',
    answerFileRequiredError: 'Нужно загрузить отдельный файл с ответами.',
    draftMissing: 'Черновик не найден. Передайте файл заново.',
    parseDefaultError: 'Не удалось обработать файл.',
    finalizeDefaultError: 'Не удалось получить ссылку.',
    notesTitle: 'Что заметил парсер',
    parsedCount: 'Вопросов найдено: <strong>{count}</strong>',
    adminContact: 'Связь с админом: <strong>{contact}</strong>',
    warningText: 'ВНИМАНИЕ: если по этой ссылке будет вход более чем с {limit} устройств, ссылка будет удалена.',
    warningButton: 'Понятно',
    siteTypeSingle: 'Одиночный',
    siteTypeGroup: 'Групповой',
  },
  uk: {
    pageTitle: 'PDMU Quiz Builder',
    'form.title': 'Створити тест',
    'form.client_title': 'Назва тесту',
    'form.source_file': 'Файл із тестами',
    'form.option_count': 'Варіантів відповіді в питанні',
    'form.answer_mode': 'Режим правильних відповідей',
    'form.answer_mode_single': 'Один і той самий варіант для всіх',
    'form.answer_mode_file': 'Окремий файл із відповідями',
    'form.answer_index': 'Правильний варіант',
    'form.answer_file': 'Файл із відповідями',
    'form.question_count': 'Кількість питань',
    'form.use_all_questions': 'Усі питання',
    'form.question_limit': 'Скільки питань взяти',
    'form.submit': 'Передати файл',
    'result.title': 'Результат',
    'status.idle': 'Очікую на завантаження файла.',
    answerFilePlaceholder: 'Підтримуються .txt, .pdf, .doc, .docx',
    accessTitle: 'Введіть код доступу',
    accessText: 'Введіть одноразовий код, щоб отримати доступ до готового посилання.',
    accessLabel: 'Одноразовий код',
    accessPlaceholder: 'Наприклад: ABCD-EFGH-JKLM',
    accessButton: 'Отримати посилання',
    parseLoading: 'Файл обробляється локальним парсером. Це може зайняти трохи часу.',
    parseSuccess: 'Тест готовий.',
    finalizeLoading: 'Перевіряю код і готую посилання.',
    finalizeSuccess: 'Посилання готове.',
    clientTitleRequiredError: 'Спочатку введіть назву тесту.',
    chooseFileError: 'Спочатку виберіть файл із тестами.',
    answerFileRequiredError: 'Потрібно завантажити окремий файл із відповідями.',
    draftMissing: 'Чернетку не знайдено. Передайте файл ще раз.',
    parseDefaultError: 'Не вдалося обробити файл.',
    finalizeDefaultError: 'Не вдалося отримати посилання.',
    notesTitle: 'Що помітив парсер',
    parsedCount: 'Питань знайдено: <strong>{count}</strong>',
    adminContact: 'Зв\'язок з адміном: <strong>{contact}</strong>',
    warningText: 'УВАГА: якщо за цим посиланням буде вхід більш ніж з {limit} пристроїв, посилання буде видалено.',
    warningButton: 'Зрозуміло',
    siteTypeSingle: 'Одиночний',
    siteTypeGroup: 'Груповий',
  },
};

let currentLanguage = resolveInitialLanguage();
let currentDraftToken = '';
let currentDraftPayload = null;

applyLanguage(currentLanguage);
syncAnswerIndexOptions();
syncQuestionLimitMode();
syncAnswerMode();

optionCountInput.addEventListener('input', syncAnswerIndexOptions);
useAllQuestionsInput.addEventListener('change', syncQuestionLimitMode);
answerModeSingleInput.addEventListener('change', syncAnswerMode);
answerModeFileInput.addEventListener('change', syncAnswerMode);
langRuBtn.addEventListener('click', () => setLanguage('ru'));
langUkBtn.addEventListener('click', () => setLanguage('uk'));

quizForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  setStatus('loading', t('parseLoading'));
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
      throw new Error(t('clientTitleRequiredError'));
    }

    if (!sourceFile) {
      throw new Error(t('chooseFileError'));
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
        throw new Error(t('answerFileRequiredError'));
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
      throw new Error(payload.error || t('parseDefaultError'));
    }

    currentDraftToken = payload.draftToken;
    currentDraftPayload = payload;
    setStatus('success', t('parseSuccess'));
    renderDraftResult(payload);
    await finalizeCurrentDraft();
  } catch (error) {
    setStatus('error', error.message || t('parseDefaultError'));
  } finally {
    submitBtn.disabled = false;
  }
});

function setLanguage(language) {
  if (!translations[language]) {
    return;
  }

  currentLanguage = language;
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  applyLanguage(language);

  if (!currentDraftToken || !currentDraftPayload) {
    return;
  }

  const hasQuizUrl = Boolean(currentDraftPayload.quizUrl);
  if (hasQuizUrl) {
    renderFinalResult(currentDraftPayload);
  } else {
    renderDraftResult(currentDraftPayload);
  }
}

function applyLanguage(language) {
  document.documentElement.lang = language === 'uk' ? 'uk' : 'ru';
  document.title = t('pageTitle');

  for (const node of document.querySelectorAll('[data-i18n]')) {
    const key = node.getAttribute('data-i18n');
    node.textContent = t(key);
  }

  answerFileInput.setAttribute('title', t('answerFilePlaceholder'));
  langRuBtn.classList.toggle('active', language === 'ru');
  langUkBtn.classList.toggle('active', language === 'uk');
}

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
        <p><strong>${escapeHtml(t('notesTitle'))}</strong></p>
        ${notes.map((note) => `<p>${escapeHtml(note)}</p>`).join('')}
      </div>
    `
    : '';
  const adminContactHtml = adminContact
    ? `<p class="admin-contact">${formatHtml(t('adminContact'), { contact: adminContact })}</p>`
    : '';

  resultBox.innerHTML = `
    <h3>${escapeHtml(payload.title)}</h3>
    <p>${formatHtml(t('parsedCount'), { count: String(payload.parsedCount || 0) })}</p>
    ${adminContactHtml}
    ${notesHtml}
    <div class="activation-box">
      <p class="activation-text">${escapeHtml(t('finalizeLoading'))}</p>
    </div>
  `;
}

async function finalizeCurrentDraft() {
  if (!currentDraftToken) {
    setStatus('error', t('draftMissing'));
    return;
  }

  setStatus('loading', t('finalizeLoading'));

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
      throw new Error(payload.error || t('finalizeDefaultError'));
    }

    currentDraftToken = '';
    currentDraftPayload = payload;
    setStatus('success', t('finalizeSuccess'));
    renderFinalResult(payload);
  } catch (error) {
    setStatus('error', error.message || t('finalizeDefaultError'));
  }
}

function renderFinalResult(payload) {
  resultBox.classList.remove('hidden');

  const warningLimit = Number(payload.warningDeviceLimit || 2);
  const localizedQuizUrl = addLanguageToUrl(payload.quizUrl);
  resultBox.innerHTML = `
    <h3>${escapeHtml(payload.title)}</h3>
    <p>${formatHtml(t('parsedCount'), { count: String(payload.parsedCount || 0) })}</p>
    <div class="warning-box">
      <p class="warning-text">${escapeHtml(t('warningText', { limit: String(warningLimit) }))}</p>
      <button id="revealQuizLinkBtn" class="primary-btn warning-btn" type="button">${escapeHtml(t('warningButton'))}</button>
    </div>
    <div id="quizLinkBox" class="hidden">
      <p><a href="${escapeAttr(localizedQuizUrl)}" target="_blank" rel="noreferrer">${escapeHtml(localizedQuizUrl)}</a></p>
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

function syncAnswerMode() {
  const answerMode = getAnswerMode();
  const useFile = answerMode === 'file';

  singleAnswerField.classList.toggle('hidden', useFile);
  answerFileField.classList.toggle('hidden', !useFile);
  answerIndexSelect.disabled = useFile;
  answerFileInput.disabled = !useFile;
  answerFileInput.required = useFile;
}

function getAnswerMode() {
  return answerModeFileInput.checked ? 'file' : 'single';
}

function resolveInitialLanguage() {
  const savedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (savedLanguage === 'ru' || savedLanguage === 'uk') {
    return savedLanguage;
  }

  return 'ru';
}

function addLanguageToUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''), window.location.origin);
    url.searchParams.set('lang', currentLanguage);
    return url.toString();
  } catch {
    return String(rawUrl || '');
  }
}

function t(key, params = {}) {
  const dictionary = translations[currentLanguage] || translations.ru;
  const fallbackDictionary = translations.ru;
  const template = dictionary[key] || fallbackDictionary[key] || key;

  return String(template).replace(/\{(\w+)\}/g, (_match, token) => String(params[token] ?? `{${token}}`));
}

function formatHtml(template, params = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_match, token) => escapeHtml(String(params[token] ?? `{${token}}`)));
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
