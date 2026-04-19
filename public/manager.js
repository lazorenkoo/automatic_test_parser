const adminSecretInput = document.getElementById('adminSecret');
const saveSecretBtn = document.getElementById('saveSecretBtn');
const refreshBtn = document.getElementById('refreshBtn');
const managerStatus = document.getElementById('managerStatus');
const managerList = document.getElementById('managerList');

const STORAGE_KEY = 'pdmu-admin-secret';

adminSecretInput.value = localStorage.getItem(STORAGE_KEY) || '';

saveSecretBtn.addEventListener('click', () => {
  localStorage.setItem(STORAGE_KEY, adminSecretInput.value.trim());
  setStatus('success', 'Секрет сохранен в браузере.');
});

refreshBtn.addEventListener('click', () => {
  void loadQuizzes();
});

void loadQuizzes();

async function loadQuizzes() {
  const secret = adminSecretInput.value.trim();
  if (!secret) {
    setStatus('idle', 'Введите admin secret и нажмите "Обновить список".');
    managerList.innerHTML = '';
    return;
  }

  setStatus('loading', 'Загружаю список тестов и статистику по устройствам.');
  refreshBtn.disabled = true;
  managerList.innerHTML = '';

  try {
    const response = await fetch('/api/admin/quizzes', {
      headers: {
        'X-Admin-Secret': secret,
      },
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Не удалось загрузить список тестов.');
    }

    renderQuizzes(payload.quizzes || []);
    setStatus('success', 'Список тестов обновлен.');
  } catch (error) {
    setStatus('error', error.message || 'Произошла ошибка.');
  } finally {
    refreshBtn.disabled = false;
  }
}

async function toggleBan(slug, banned) {
  const secret = adminSecretInput.value.trim();
  if (!secret) {
    setStatus('error', 'Сначала введите admin secret.');
    return;
  }

  setStatus('loading', banned ? 'Блокирую тест.' : 'Возвращаю тест.');

  try {
    const response = await fetch(`/api/admin/quizzes/${encodeURIComponent(slug)}/ban`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': secret,
      },
      body: JSON.stringify({ banned }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Не удалось изменить статус теста.');
    }

    await loadQuizzes();
  } catch (error) {
    setStatus('error', error.message || 'Произошла ошибка.');
  }
}

function renderQuizzes(quizzes) {
  if (!quizzes.length) {
    managerList.innerHTML = '<section class="empty-box">Пока нет ни одного созданного теста.</section>';
    return;
  }

  managerList.innerHTML = quizzes.map((quiz) => {
    const statusClass = quiz.bannedAt ? 'banned' : 'active';
    const statusText = quiz.bannedAt ? 'Забанен' : 'Активен';
    const devices = Array.isArray(quiz.devices) ? quiz.devices : [];

    const devicesHtml = devices.length
      ? `
        <div class="device-list">
          ${devices.map((device) => `
            <div class="device-item">
              <strong>${escapeHtml(maskDeviceId(device.deviceId))}</strong>
              <p>Первый вход: ${escapeHtml(formatDateTime(device.firstSeenAt))}</p>
              <p>Последний вход: ${escapeHtml(formatDateTime(device.lastSeenAt))}</p>
              <p>IP: ${escapeHtml(device.lastIp || 'неизвестно')}</p>
              <p>User-Agent: ${escapeHtml(device.lastUserAgent || 'неизвестно')}</p>
            </div>
          `).join('')}
        </div>
      `
      : '<div class="device-list"><div class="device-item"><p>Пока еще не было ни одного входа.</p></div></div>';

    return `
      <section class="quiz-card">
        <div class="quiz-top">
          <div>
            <h3>${escapeHtml(quiz.title)}</h3>
            <p>${escapeHtml(quiz.slug)}</p>
          </div>
          <div class="badge ${statusClass}">${escapeHtml(statusText)}</div>
        </div>

        <div class="quiz-meta">
          <div class="quiz-meta-item">
            <span>Вопросов</span>
            <strong>${escapeHtml(String(quiz.parsedCount || 0))}</strong>
          </div>
          <div class="quiz-meta-item">
            <span>Устройств</span>
            <strong>${escapeHtml(String(quiz.deviceCount || 0))}</strong>
          </div>
          <div class="quiz-meta-item">
            <span>Создан</span>
            <strong>${escapeHtml(formatDateTime(quiz.createdAt))}</strong>
          </div>
          <div class="quiz-meta-item">
            <span>Последний вход</span>
            <strong>${escapeHtml(formatDateTime(quiz.lastSeenAt))}</strong>
          </div>
          <div class="quiz-meta-item">
            <span>Источник</span>
            <strong>${escapeHtml(quiz.sourceFilename || '—')}</strong>
          </div>
        </div>

        <div class="quiz-actions">
          <a class="secondary-btn" href="${escapeAttr(quiz.quizUrl)}" target="_blank" rel="noreferrer">Открыть тест</a>
          <button class="primary-btn" type="button" data-toggle-ban="${escapeAttr(quiz.slug)}" data-banned="${quiz.bannedAt ? '1' : '0'}">
            ${quiz.bannedAt ? 'Вернуть тест' : 'Забанить тест'}
          </button>
        </div>

        ${devicesHtml}
      </section>
    `;
  }).join('');

  for (const button of managerList.querySelectorAll('[data-toggle-ban]')) {
    button.addEventListener('click', () => {
      const slug = button.getAttribute('data-toggle-ban') || '';
      const currentlyBanned = button.getAttribute('data-banned') === '1';
      void toggleBan(slug, !currentlyBanned);
    });
  }
}

function setStatus(kind, message) {
  managerStatus.className = `status ${kind}`;
  managerStatus.textContent = message;
}

function formatDateTime(value) {
  if (!value) {
    return '—';
  }

  return new Date(Number(value)).toLocaleString('ru-RU');
}

function maskDeviceId(value) {
  const text = String(value || '');
  if (text.length <= 12) {
    return text || 'device';
  }

  return `${text.slice(0, 8)}...${text.slice(-4)}`;
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
