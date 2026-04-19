const quizForm = document.getElementById('quizForm');
const submitBtn = document.getElementById('submitBtn');
const statusBox = document.getElementById('statusBox');
const resultBox = document.getElementById('resultBox');
const answerIndexSelect = document.getElementById('answerIndex');
const optionCountInput = document.getElementById('optionCount');

syncAnswerIndexOptions();
optionCountInput.addEventListener('input', syncAnswerIndexOptions);

quizForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus('loading', 'Файл читается локальным парсером. Это может занять немного времени.');
  resultBox.classList.add('hidden');
  resultBox.innerHTML = '';
  submitBtn.disabled = true;

  try {
    const formData = new FormData(quizForm);
    const response = await fetch('/api/quizzes', {
      method: 'POST',
      body: formData,
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Не удалось создать тест.');
    }

    setStatus('success', 'Тест успешно создан.');
    renderResult(payload);
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

function renderResult(payload) {
  resultBox.classList.remove('hidden');
  resultBox.innerHTML = `
    <h3>${escapeHtml(payload.title)}</h3>
    <p>Вопросов распарсено: <strong>${payload.parsedCount}</strong></p>
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
