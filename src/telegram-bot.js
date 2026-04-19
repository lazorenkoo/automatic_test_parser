import TelegramBot from 'node-telegram-bot-api';
import {
  createAccessCodes,
  deleteQuizById,
  getDbMeta,
  listQuizzesForAdmin,
  setQuizBanStatusById,
} from './db.js';

let botInstance = null;
let shutdownBound = false;

export function startTelegramBot() {
  if (botInstance) {
    return botInstance;
  }

  const enabled = String(process.env.TELEGRAM_BOT_ENABLED || '0') === '1';
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const adminUserId = Number(process.env.TELEGRAM_ADMIN_USER_ID || 0);

  if (!enabled || !token) {
    return null;
  }

  const bot = new TelegramBot(token, { polling: true });
  botInstance = bot;

  const helpText = [
    'Команды бота:',
    '/code <type> <questions> <tg_user> [label] - создать 1 код',
    '/codes <count> <type> <questions> <tg_user> [label] - создать несколько кодов',
    '/sites [page] [type=1] [tg=@user] [min_devices=2] [max_devices=5] [status=active|banned|all] [before=2026-04-20] [after=2026-04-01] - список сайтов',
    '/site <id> - подробности по одному сайту',
    '/ban <id> - забанить один сайт',
    '/ban <type> <N> - забанить сайты типа 1 или 2, где устройств больше N',
    '/unban <id> - вернуть сайт',
    '/delete <id> - удалить один сайт',
    '/delete before=2026-04-01 [type=1] [tg=@user] [status=banned] - удалить сайты по фильтру',
    '/db - показать путь к SQLite базе',
    '/id - показать ваш Telegram ID',
    '/help - показать помощь',
  ].join('\n');

  bot.setMyCommands([
    { command: 'code', description: 'Создать 1 код доступа' },
    { command: 'codes', description: 'Создать несколько кодов' },
    { command: 'sites', description: 'Список сайтов' },
    { command: 'site', description: 'Детали по сайту' },
    { command: 'ban', description: 'Забанить сайт' },
    { command: 'unban', description: 'Вернуть сайт' },
    { command: 'delete', description: 'Удалить сайт' },
    { command: 'db', description: 'Путь к SQLite базе' },
    { command: 'id', description: 'Ваш Telegram ID' },
    { command: 'help', description: 'Помощь' },
  ]).catch(() => {});

  bot.onText(/^\/id(?:@[\w_]+)?$/i, async (msg) => {
    if (!isPrivateChat(msg)) {
      return;
    }

    await bot.sendMessage(msg.chat.id, [
      `Ваш user id: ${msg.from?.id ?? 'unknown'}`,
      `Ваш chat id: ${msg.chat.id}`,
    ].join('\n'));
  });

  bot.onText(/^\/(?:start|help)(?:@[\w_]+)?$/i, async (msg) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    await bot.sendMessage(msg.chat.id, helpText);
  });

  bot.onText(/^\/db(?:@[\w_]+)?$/i, async (msg) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const meta = getDbMeta();
    await bot.sendMessage(msg.chat.id, `SQLite база:\n${meta.dbPath}`);
  });

  bot.onText(/^\/code(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const parsed = parseSingleCodeArgs(match?.[1]);
    if (!parsed.ok) {
      await bot.sendMessage(msg.chat.id, parsed.error);
      return;
    }

    const code = createAccessCodes(1, parsed.label, {
      siteType: parsed.siteType,
      clientTgUsername: parsed.clientUsername,
      expectedQuestionCount: parsed.questionCount,
    })[0];

    await bot.sendMessage(msg.chat.id, formatCreatedCodesMessage([code], parsed));
  });

  bot.onText(/^\/codes(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const parsed = parseBatchCodeArgs(match?.[1]);
    if (!parsed.ok) {
      await bot.sendMessage(msg.chat.id, parsed.error);
      return;
    }

    const codes = createAccessCodes(parsed.count, parsed.label, {
      siteType: parsed.siteType,
      clientTgUsername: parsed.clientUsername,
      expectedQuestionCount: parsed.questionCount,
    });

    await bot.sendMessage(msg.chat.id, formatCreatedCodesMessage(codes, parsed));
  });

  bot.onText(/^\/sites(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const parsed = parseSitesArgs(match?.[1]);
    if (!parsed.ok) {
      await bot.sendMessage(msg.chat.id, parsed.error);
      return;
    }

    await bot.sendMessage(msg.chat.id, formatSitesPage(parsed), { disable_web_page_preview: true });
  });

  bot.onText(/^\/site(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const numericId = Number(String(match?.[1] || '').trim());
    if (!Number.isInteger(numericId) || numericId < 1) {
      await bot.sendMessage(msg.chat.id, 'Формат: /site <id>');
      return;
    }

    const quiz = listQuizzesForAdmin().find((item) => item.id === numericId);
    if (!quiz) {
      await bot.sendMessage(msg.chat.id, `Сайт с id ${numericId} не найден.`);
      return;
    }

    await bot.sendMessage(msg.chat.id, formatSiteDetails(quiz), { disable_web_page_preview: true });
  });

  bot.onText(/^\/ban(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const parsed = parseBanArgs(match?.[1]);
    if (!parsed.ok) {
      await bot.sendMessage(msg.chat.id, parsed.error);
      return;
    }

    if (parsed.mode === 'single') {
      const quiz = setQuizBanStatusById(parsed.id, true);
      if (!quiz) {
        await bot.sendMessage(msg.chat.id, `Сайт с id ${parsed.id} не найден.`);
        return;
      }

      await bot.sendMessage(msg.chat.id, `Сайт ${quiz.id} забанен.\n${quiz.title}`);
      return;
    }

    const candidates = listQuizzesForAdmin().filter((quiz) => (
      String(quiz.siteType || '') === parsed.siteType &&
      Number(quiz.deviceCount || 0) > parsed.minDevices &&
      !quiz.bannedAt
    ));

    if (!candidates.length) {
      await bot.sendMessage(
        msg.chat.id,
        `Нет активных сайтов типа ${parsed.siteType}, где устройств больше ${parsed.minDevices}.`,
      );
      return;
    }

    const bannedLines = [];
    for (const quiz of candidates) {
      const bannedQuiz = setQuizBanStatusById(quiz.id, true);
      if (bannedQuiz) {
        bannedLines.push(`${bannedQuiz.id} | ${formatSiteType(bannedQuiz.siteType)} | устройств ${bannedQuiz.deviceCount || 0}`);
      }
    }

    await bot.sendMessage(msg.chat.id, [
      `Забанено сайтов: ${bannedLines.length}`,
      `Тип сайта: ${formatSiteType(parsed.siteType)}`,
      `Условие: устройств > ${parsed.minDevices}`,
      '',
      ...bannedLines,
    ].join('\n'));
  });

  bot.onText(/^\/unban(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const numericId = Number(String(match?.[1] || '').trim());
    if (!Number.isInteger(numericId) || numericId < 1) {
      await bot.sendMessage(msg.chat.id, 'Формат: /unban <id>');
      return;
    }

    const quiz = setQuizBanStatusById(numericId, false);
    if (!quiz) {
      await bot.sendMessage(msg.chat.id, `Сайт с id ${numericId} не найден.`);
      return;
    }

    await bot.sendMessage(msg.chat.id, `Сайт ${quiz.id} снова активен.\n${quiz.title}`);
  });

  bot.onText(/^\/delete(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const parsed = parseDeleteArgs(match?.[1]);
    if (!parsed.ok) {
      await bot.sendMessage(msg.chat.id, parsed.error);
      return;
    }

    if (parsed.mode === 'single') {
      const deletedQuiz = deleteQuizById(parsed.id);
      if (!deletedQuiz) {
        await bot.sendMessage(msg.chat.id, `Сайт с id ${parsed.id} не найден.`);
        return;
      }

      await bot.sendMessage(msg.chat.id, `Сайт удален:\n${deletedQuiz.id}. ${deletedQuiz.title}`);
      return;
    }

    const candidates = listQuizzesForAdmin().filter((quiz) => matchesQuizFilters(quiz, parsed.filters));
    if (!candidates.length) {
      await bot.sendMessage(msg.chat.id, 'По заданным фильтрам ничего не найдено.');
      return;
    }

    const deletedLines = [];
    for (const quiz of candidates) {
      const deletedQuiz = deleteQuizById(quiz.id);
      if (deletedQuiz) {
        deletedLines.push(`${deletedQuiz.id}. ${deletedQuiz.title}`);
      }
    }

    await bot.sendMessage(msg.chat.id, [
      `Удалено сайтов: ${deletedLines.length}`,
      '',
      ...deletedLines.slice(0, 30),
      deletedLines.length > 30 ? '...' : null,
    ].filter(Boolean).join('\n'));
  });

  bot.on('polling_error', (error) => {
    console.error('Telegram polling error:', error?.message || error);
  });

  bindShutdown(bot);
  if (adminUserId) {
    console.log(`Telegram bot started for admin user ${adminUserId}`);
  } else {
    console.log('Telegram bot started in setup mode. Send /id to get your Telegram user id.');
  }
  return bot;
}

async function ensureAuthorized(bot, msg, adminUserId) {
  if (!adminUserId) {
    await explainSetup(bot, msg);
    return false;
  }

  if (!isPrivateChat(msg) || Number(msg.from?.id || 0) !== adminUserId) {
    await deny(bot, msg);
    return false;
  }

  return true;
}

function isPrivateChat(msg) {
  return msg.chat?.type === 'private';
}

function parseSingleCodeArgs(rawValue) {
  const parts = tokenizeArgs(rawValue);
  if (parts.length < 3) {
    return {
      ok: false,
      error: 'Формат: /code <type> <questions> <tg_user> [label]\nПример: /code 1 50 @ivan client-a',
    };
  }

  const siteType = normalizeSiteType(parts[0]);
  const questionCount = normalizeQuestionCount(parts[1]);
  const clientUsername = normalizeClientUsername(parts[2]);

  if (!siteType) {
    return { ok: false, error: 'Тип сайта должен быть 1 или 2.' };
  }

  if (!questionCount) {
    return { ok: false, error: 'Количество вопросов должно быть целым числом больше 0.' };
  }

  if (!clientUsername) {
    return { ok: false, error: 'Укажите Telegram user клиента. Пример: @ivan' };
  }

  return {
    ok: true,
    count: 1,
    siteType,
    questionCount,
    clientUsername,
    label: parts.slice(3).join(' ').trim() || null,
  };
}

function parseBatchCodeArgs(rawValue) {
  const parts = tokenizeArgs(rawValue);
  if (parts.length < 4) {
    return {
      ok: false,
      error: 'Формат: /codes <count> <type> <questions> <tg_user> [label]\nПример: /codes 5 2 80 @ivan april-batch',
    };
  }

  const count = Math.max(1, Math.min(100, Number(parts[0] || 1)));
  const siteType = normalizeSiteType(parts[1]);
  const questionCount = normalizeQuestionCount(parts[2]);
  const clientUsername = normalizeClientUsername(parts[3]);

  if (!Number.isInteger(count) || count < 1) {
    return { ok: false, error: 'Количество кодов должно быть целым числом от 1 до 100.' };
  }

  if (!siteType) {
    return { ok: false, error: 'Тип сайта должен быть 1 или 2.' };
  }

  if (!questionCount) {
    return { ok: false, error: 'Количество вопросов должно быть целым числом больше 0.' };
  }

  if (!clientUsername) {
    return { ok: false, error: 'Укажите Telegram user клиента. Пример: @ivan' };
  }

  return {
    ok: true,
    count,
    siteType,
    questionCount,
    clientUsername,
    label: parts.slice(4).join(' ').trim() || null,
  };
}

function parseSitesArgs(rawValue) {
  const parts = tokenizeArgs(rawValue);
  const result = {
    ok: true,
    page: 1,
    filters: {
      type: null,
      tg: null,
      minDevices: null,
      maxDevices: null,
      status: 'all',
      before: null,
      after: null,
    },
  };

  for (const part of parts) {
    if (/^\d+$/.test(part) && result.page === 1) {
      result.page = Math.max(1, Number(part));
      continue;
    }

    const parsedFilter = applyFilterPart(result.filters, part);
    if (!parsedFilter.ok) {
      return parsedFilter;
    }
  }

  return result;
}

function parseBanArgs(rawValue) {
  const parts = tokenizeArgs(rawValue);

  if (parts.length === 1) {
    const numericId = Number(parts[0]);
    if (!Number.isInteger(numericId) || numericId < 1) {
      return {
        ok: false,
        error: 'Формат: /ban <id> или /ban <type> <N>\nПримеры:\n/ban 32\n/ban 1 3',
      };
    }

    return { ok: true, mode: 'single', id: numericId };
  }

  if (parts.length === 2) {
    const siteType = normalizeSiteType(parts[0]);
    const minDevices = Number(parts[1]);

    if (!siteType) {
      return { ok: false, error: 'Тип сайта должен быть 1 или 2.' };
    }

    if (!Number.isInteger(minDevices) || minDevices < 0) {
      return { ok: false, error: 'Количество устройств N должно быть целым числом 0 или больше.' };
    }

    return { ok: true, mode: 'filtered', siteType, minDevices };
  }

  return {
    ok: false,
    error: 'Формат: /ban <id> или /ban <type> <N>\nПримеры:\n/ban 32\n/ban 1 3',
  };
}

function parseDeleteArgs(rawValue) {
  const parts = tokenizeArgs(rawValue);
  if (!parts.length) {
    return {
      ok: false,
      error: 'Формат: /delete <id> или /delete before=2026-04-01 [type=1] [tg=@user]',
    };
  }

  if (parts.length === 1 && /^\d+$/.test(parts[0])) {
    return {
      ok: true,
      mode: 'single',
      id: Number(parts[0]),
    };
  }

  const filters = {
    type: null,
    tg: null,
    minDevices: null,
    maxDevices: null,
    status: 'all',
    before: null,
    after: null,
  };

  for (const part of parts) {
    const parsedFilter = applyFilterPart(filters, part);
    if (!parsedFilter.ok) {
      return parsedFilter;
    }
  }

  if (!filters.before && !filters.after && !filters.type && !filters.tg && filters.minDevices === null && filters.maxDevices === null && filters.status === 'all') {
    return {
      ok: false,
      error: 'Для удаления по фильтру укажите хотя бы один фильтр, например before=2026-04-01 или type=1.',
    };
  }

  return {
    ok: true,
    mode: 'filtered',
    filters,
  };
}

function applyFilterPart(filters, part) {
  const [key, value = ''] = part.split('=');
  const normalizedKey = String(key || '').trim().toLowerCase();
  const normalizedValue = String(value || '').trim();

  if (normalizedKey === 'type') {
    const siteType = normalizeSiteType(normalizedValue);
    if (!siteType) {
      return { ok: false, error: 'Фильтр type поддерживает только 1 или 2.' };
    }
    filters.type = siteType;
    return { ok: true };
  }

  if (normalizedKey === 'tg') {
    const username = normalizeClientUsername(normalizedValue);
    if (!username) {
      return { ok: false, error: 'Фильтр tg указывается как tg=@username.' };
    }
    filters.tg = username;
    return { ok: true };
  }

  if (normalizedKey === 'min_devices') {
    const numericValue = Number(normalizedValue);
    if (!Number.isInteger(numericValue) || numericValue < 0) {
      return { ok: false, error: 'min_devices должен быть целым числом 0 или больше.' };
    }
    filters.minDevices = numericValue;
    return { ok: true };
  }

  if (normalizedKey === 'max_devices') {
    const numericValue = Number(normalizedValue);
    if (!Number.isInteger(numericValue) || numericValue < 0) {
      return { ok: false, error: 'max_devices должен быть целым числом 0 или больше.' };
    }
    filters.maxDevices = numericValue;
    return { ok: true };
  }

  if (normalizedKey === 'status') {
    const normalizedStatus = normalizedValue.toLowerCase();
    if (!['active', 'banned', 'all'].includes(normalizedStatus)) {
      return { ok: false, error: 'status поддерживает active, banned или all.' };
    }
    filters.status = normalizedStatus;
    return { ok: true };
  }

  if (normalizedKey === 'before' || normalizedKey === 'after') {
    const timestamp = normalizeDateFilter(normalizedValue);
    if (!timestamp) {
      return { ok: false, error: `${normalizedKey} указывается как YYYY-MM-DD.` };
    }
    filters[normalizedKey] = timestamp;
    return { ok: true };
  }

  return {
    ok: false,
    error: 'Неизвестный фильтр. Используйте: type=1 tg=@user min_devices=2 max_devices=5 status=active before=2026-04-20',
  };
}

function formatCreatedCodesMessage(codes, parsed) {
  const common = [
    `Количество тестов: ${parsed.questionCount}`,
    `Клиент: ${parsed.clientUsername}`,
    `Тип: ${formatSiteType(parsed.siteType)}`,
    parsed.label ? `Label: ${parsed.label}` : null,
  ].filter(Boolean);

  if (codes.length === 1) {
    return [
      `Код: ${codes[0]}`,
      ...common,
    ].join('\n');
  }

  return [
    `Создано кодов: ${codes.length}`,
    ...common,
    '',
    ...codes.map((code, index) => `${index + 1}. ${code}`),
  ].join('\n');
}

function formatSitesPage(parsed) {
  const pageSize = 30;
  const allQuizzes = listQuizzesForAdmin();
  const filtered = allQuizzes.filter((quiz) => matchesQuizFilters(quiz, parsed.filters));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(parsed.page, totalPages);
  const items = filtered.slice((page - 1) * pageSize, page * pageSize);

  const filterSummary = summarizeFilters(parsed.filters);
  if (!items.length) {
    return [
      'Сайты не найдены.',
      filterSummary ? `Фильтры: ${filterSummary}` : null,
    ].filter(Boolean).join('\n');
  }

  return [
    `Сайты: страница ${page} из ${totalPages}`,
    `Всего найдено: ${filtered.length}`,
    filterSummary ? `Фильтры: ${filterSummary}` : null,
    '',
    ...items.map((quiz) => formatSiteListItem(quiz)),
    '',
    page < totalPages ? `Дальше: /sites ${page + 1}${filterSummary ? ` ${filterSummary}` : ''}` : 'Это последняя страница.',
  ].filter(Boolean).join('\n');
}

function formatSiteListItem(quiz) {
  const description = quiz.codeLabel ? ` | ${quiz.codeLabel}` : '';
  return `${quiz.id}. ${formatSiteType(quiz.siteType)}${description} | устройств ${quiz.deviceCount || 0} | ${quiz.clientTgUsername || 'не привязан'}${quiz.bannedAt ? ' | БАН' : ''}`;
}

function formatSiteDetails(quiz) {
  const devices = Array.isArray(quiz.devices) ? quiz.devices : [];
  return [
    `Сайт ${quiz.id}`,
    `Название: ${quiz.title}`,
    `Slug: ${quiz.slug}`,
    `Тип: ${formatSiteType(quiz.siteType)}`,
    `Описание: ${quiz.codeLabel || '—'}`,
    `Клиент: ${quiz.clientTgUsername || 'не привязан'}`,
    `Количество вопросов: ${quiz.expectedQuestionCount || quiz.requestedCount || quiz.parsedCount || 0}`,
    `Найдено вопросов: ${quiz.parsedCount || 0}`,
    `Устройств: ${quiz.deviceCount || 0}`,
    `Статус: ${quiz.bannedAt ? 'забанен' : 'активен'}`,
    `Создан: ${formatDateTime(quiz.createdAt)}`,
    `Последний вход: ${formatDateTime(quiz.lastSeenAt)}`,
    '',
    devices.length
      ? devices.slice(0, 10).map((device, index) => `${index + 1}) ${maskDeviceId(device.deviceId)} | ${formatDateTime(device.lastSeenAt)} | ${device.lastIp || 'IP ?'}`).join('\n')
      : 'Входов пока не было.',
  ].join('\n');
}

function matchesQuizFilters(quiz, filters) {
  if (filters.type && String(quiz.siteType || '') !== String(filters.type)) {
    return false;
  }

  if (filters.tg && normalizeClientUsername(quiz.clientTgUsername) !== filters.tg) {
    return false;
  }

  const deviceCount = Number(quiz.deviceCount || 0);
  if (filters.minDevices !== null && deviceCount < filters.minDevices) {
    return false;
  }

  if (filters.maxDevices !== null && deviceCount > filters.maxDevices) {
    return false;
  }

  if (filters.status === 'active' && quiz.bannedAt) {
    return false;
  }

  if (filters.status === 'banned' && !quiz.bannedAt) {
    return false;
  }

  if (filters.before && Number(quiz.createdAt || 0) >= filters.before) {
    return false;
  }

  if (filters.after && Number(quiz.createdAt || 0) < filters.after) {
    return false;
  }

  return true;
}

function summarizeFilters(filters) {
  return [
    filters.type ? `type=${filters.type}` : null,
    filters.tg ? `tg=${filters.tg}` : null,
    filters.minDevices !== null ? `min_devices=${filters.minDevices}` : null,
    filters.maxDevices !== null ? `max_devices=${filters.maxDevices}` : null,
    filters.status !== 'all' ? `status=${filters.status}` : null,
    filters.before ? `before=${formatDateOnly(filters.before)}` : null,
    filters.after ? `after=${formatDateOnly(filters.after)}` : null,
  ].filter(Boolean).join(' ');
}

function tokenizeArgs(rawValue) {
  return String(rawValue || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeSiteType(value) {
  const normalized = String(value || '').trim();
  return normalized === '1' || normalized === '2' ? normalized : '';
}

function normalizeQuestionCount(value) {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 1) {
    return 0;
  }

  return numericValue;
}

function normalizeClientUsername(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/^@+/, '');
  return normalized ? `@${normalized}` : '';
}

function normalizeDateFilter(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    return 0;
  }

  const date = new Date(`${value}T00:00:00`);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatSiteType(siteType) {
  return String(siteType || '') === '2' ? 'Групповой' : 'Одиночный';
}

function formatDateTime(value) {
  if (!value) {
    return '—';
  }

  return new Date(Number(value)).toLocaleString('ru-RU');
}

function formatDateOnly(value) {
  if (!value) {
    return '';
  }

  const date = new Date(Number(value));
  return date.toISOString().slice(0, 10);
}

function maskDeviceId(value) {
  const text = String(value || '');
  if (text.length <= 12) {
    return text || 'device';
  }

  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

async function deny(bot, msg) {
  if (!isPrivateChat(msg)) {
    return;
  }

  await bot.sendMessage(msg.chat.id, 'Нет доступа к этому боту.');
}

async function explainSetup(bot, msg) {
  if (!isPrivateChat(msg)) {
    return;
  }

  await bot.sendMessage(msg.chat.id, [
    'Бот еще не привязан к вашему Telegram ID.',
    'Отправьте /id, затем вставьте это значение в TELEGRAM_ADMIN_USER_ID и перезапустите сервер.',
  ].join('\n'));
}

function bindShutdown(bot) {
  if (shutdownBound) {
    return;
  }

  shutdownBound = true;
  const stopBot = () => {
    bot.stopPolling().catch(() => {});
  };

  process.once('SIGINT', stopBot);
  process.once('SIGTERM', stopBot);
}
