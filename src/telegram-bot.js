import TelegramBot from 'node-telegram-bot-api';
import {
  createAccessCodes,
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
    '/code <type> <tg_user> [label] - создать 1 код',
    '/codes <count> <type> <tg_user> [label] - создать несколько кодов',
    '/sites [page] [type=1] [tg=@user] [min_devices=2] [max_devices=5] [status=active|banned|all] - список сайтов',
    '/site <id> - подробности по одному сайту',
    '/ban <id> - забанить один сайт',
    '/ban <type> <N> - забанить сайты типа 1 или 2, где устройств больше N',
    '/unban <id> - вернуть сайт',
    '/db - показать путь к SQLite базе',
    '/id - показать ваш Telegram ID',
    '/help - показать помощь',
  ].join('\n');

  bot.setMyCommands([
    { command: 'code', description: 'Создать 1 код доступа' },
    { command: 'codes', description: 'Создать несколько кодов' },
    { command: 'sites', description: 'Список сайтов' },
    { command: 'site', description: 'Детали по сайту' },
    { command: 'ban', description: 'Забанить один сайт или группу' },
    { command: 'unban', description: 'Вернуть сайт' },
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
    if (!adminUserId) {
      await explainSetup(bot, msg);
      return;
    }

    if (!isAuthorized(msg, adminUserId)) {
      await deny(bot, msg);
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
    })[0];

    await bot.sendMessage(msg.chat.id, formatCreatedCodesMessage([code], parsed, 1));
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
    });

    await bot.sendMessage(msg.chat.id, formatCreatedCodesMessage(codes, parsed, parsed.count));
  });

  bot.onText(/^\/sites(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const filters = parseSitesArgs(match?.[1]);
    if (!filters.ok) {
      await bot.sendMessage(msg.chat.id, filters.error);
      return;
    }

    const message = formatSitesPage(filters);
    await bot.sendMessage(msg.chat.id, message, { disable_web_page_preview: true });
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

    const quizzes = listQuizzesForAdmin().filter((quiz) => (
      String(quiz.siteType || '') === parsed.siteType &&
      Number(quiz.deviceCount || 0) > parsed.minDevices &&
      !quiz.bannedAt
    ));

    if (!quizzes.length) {
      await bot.sendMessage(
        msg.chat.id,
        `Нет активных сайтов типа ${parsed.siteType}, где устройств больше ${parsed.minDevices}.`,
      );
      return;
    }

    const bannedIds = [];
    for (const quiz of quizzes) {
      const bannedQuiz = setQuizBanStatusById(quiz.id, true);
      if (bannedQuiz) {
        bannedIds.push(`${bannedQuiz.id} (${bannedQuiz.deviceCount || 0} устройств)`);
      }
    }

    await bot.sendMessage(msg.chat.id, [
      `Забанено сайтов: ${bannedIds.length}`,
      `Тип сайта: ${parsed.siteType}`,
      `Условие: устройств > ${parsed.minDevices}`,
      '',
      ...bannedIds,
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

function isAuthorized(msg, adminUserId) {
  return isPrivateChat(msg) && Number(msg.from?.id || 0) === adminUserId;
}

function isPrivateChat(msg) {
  return msg.chat?.type === 'private';
}

async function ensureAuthorized(bot, msg, adminUserId) {
  if (!adminUserId) {
    await explainSetup(bot, msg);
    return false;
  }

  if (!isAuthorized(msg, adminUserId)) {
    await deny(bot, msg);
    return false;
  }

  return true;
}

function parseSingleCodeArgs(rawValue) {
  const parts = tokenizeArgs(rawValue);
  if (parts.length < 2) {
    return {
      ok: false,
      error: 'Формат: /code <type> <tg_user> [label]\nПример: /code 1 @ivan client-a',
    };
  }

  const siteType = normalizeSiteType(parts[0]);
  if (!siteType) {
    return {
      ok: false,
      error: 'Тип сайта должен быть 1 или 2.',
    };
  }

  const clientUsername = normalizeClientUsername(parts[1]);
  if (!clientUsername) {
    return {
      ok: false,
      error: 'Укажите Telegram user клиента. Пример: @ivan',
    };
  }

  return {
    ok: true,
    count: 1,
    siteType,
    clientUsername,
    label: parts.slice(2).join(' ').trim() || null,
  };
}

function parseBatchCodeArgs(rawValue) {
  const parts = tokenizeArgs(rawValue);
  if (parts.length < 3) {
    return {
      ok: false,
      error: 'Формат: /codes <count> <type> <tg_user> [label]\nПример: /codes 5 2 @ivan april-batch',
    };
  }

  const count = Math.max(1, Math.min(100, Number(parts[0] || 1)));
  if (!Number.isInteger(count) || count < 1) {
    return {
      ok: false,
      error: 'Количество кодов должно быть целым числом от 1 до 100.',
    };
  }

  const siteType = normalizeSiteType(parts[1]);
  if (!siteType) {
    return {
      ok: false,
      error: 'Тип сайта должен быть 1 или 2.',
    };
  }

  const clientUsername = normalizeClientUsername(parts[2]);
  if (!clientUsername) {
    return {
      ok: false,
      error: 'Укажите Telegram user клиента. Пример: @ivan',
    };
  }

  return {
    ok: true,
    count,
    siteType,
    clientUsername,
    label: parts.slice(3).join(' ').trim() || null,
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
    },
  };

  for (const part of parts) {
    if (/^\d+$/.test(part) && result.page === 1) {
      result.page = Math.max(1, Number(part));
      continue;
    }

    const [key, value = ''] = part.split('=');
    const normalizedKey = String(key || '').trim().toLowerCase();
    const normalizedValue = String(value || '').trim();

    if (normalizedKey === 'type') {
      const siteType = normalizeSiteType(normalizedValue);
      if (!siteType) {
        return { ok: false, error: 'Фильтр type поддерживает только 1 или 2.' };
      }
      result.filters.type = siteType;
      continue;
    }

    if (normalizedKey === 'tg') {
      const username = normalizeClientUsername(normalizedValue);
      if (!username) {
        return { ok: false, error: 'Фильтр tg указывается как tg=@username.' };
      }
      result.filters.tg = username;
      continue;
    }

    if (normalizedKey === 'min_devices') {
      const numericValue = Number(normalizedValue);
      if (!Number.isInteger(numericValue) || numericValue < 0) {
        return { ok: false, error: 'min_devices должен быть целым числом 0 или больше.' };
      }
      result.filters.minDevices = numericValue;
      continue;
    }

    if (normalizedKey === 'max_devices') {
      const numericValue = Number(normalizedValue);
      if (!Number.isInteger(numericValue) || numericValue < 0) {
        return { ok: false, error: 'max_devices должен быть целым числом 0 или больше.' };
      }
      result.filters.maxDevices = numericValue;
      continue;
    }

    if (normalizedKey === 'status') {
      const normalizedStatus = normalizedValue.toLowerCase();
      if (!['active', 'banned', 'all'].includes(normalizedStatus)) {
        return { ok: false, error: 'status поддерживает active, banned или all.' };
      }
      result.filters.status = normalizedStatus;
      continue;
    }

    return {
      ok: false,
      error: 'Неизвестный фильтр. Используйте: type=1 tg=@user min_devices=2 max_devices=5 status=active',
    };
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

    return {
      ok: true,
      mode: 'single',
      id: numericId,
    };
  }

  if (parts.length === 2) {
    const siteType = normalizeSiteType(parts[0]);
    const minDevices = Number(parts[1]);

    if (!siteType) {
      return {
        ok: false,
        error: 'Тип сайта должен быть 1 или 2.',
      };
    }

    if (!Number.isInteger(minDevices) || minDevices < 0) {
      return {
        ok: false,
        error: 'Количество устройств N должно быть целым числом 0 или больше.',
      };
    }

    return {
      ok: true,
      mode: 'filtered',
      siteType,
      minDevices,
    };
  }

  return {
    ok: false,
    error: 'Формат: /ban <id> или /ban <type> <N>\nПримеры:\n/ban 32\n/ban 1 3',
  };
}

function formatCreatedCodesMessage(codes, parsed, requestedCount) {
  return [
    requestedCount === 1 ? 'Новый код доступа:' : `Создано кодов: ${codes.length}`,
    `Тип сайта: ${parsed.siteType}`,
    `Клиент: ${parsed.clientUsername}`,
    parsed.label ? `Label: ${parsed.label}` : null,
    '',
    ...codes,
    '',
    'После использования код останется привязан к созданному сайту.',
  ].filter(Boolean).join('\n');
}

function formatSitesPage(parsed) {
  const pageSize = 30;
  const allQuizzes = listQuizzesForAdmin();
  const filtered = allQuizzes.filter((quiz) => matchesQuizFilters(quiz, parsed.filters));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(parsed.page, totalPages);
  const items = filtered.slice((page - 1) * pageSize, page * pageSize);

  const filterSummary = [
    parsed.filters.type ? `type=${parsed.filters.type}` : null,
    parsed.filters.tg ? `tg=${parsed.filters.tg}` : null,
    parsed.filters.minDevices !== null ? `min_devices=${parsed.filters.minDevices}` : null,
    parsed.filters.maxDevices !== null ? `max_devices=${parsed.filters.maxDevices}` : null,
    parsed.filters.status !== 'all' ? `status=${parsed.filters.status}` : null,
  ].filter(Boolean).join(' ');

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
  const title = String(quiz.title || '').trim();
  const compactTitle = title.length > 42 ? `${title.slice(0, 39)}...` : title;
  return `${quiz.id}. тип ${quiz.siteType || '—'} | устройств ${quiz.deviceCount || 0} | ${quiz.clientTgUsername || 'не привязан'}${quiz.bannedAt ? ' | БАН' : ''} | ${compactTitle}`;
}

function formatSiteDetails(quiz) {
  const devices = Array.isArray(quiz.devices) ? quiz.devices : [];
  return [
    `Сайт ${quiz.id}`,
    `Название: ${quiz.title}`,
    `Slug: ${quiz.slug}`,
    `Тип сайта: ${quiz.siteType || '—'}`,
    `Клиент: ${quiz.clientTgUsername || 'не привязан'}`,
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

  return true;
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

function normalizeClientUsername(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/^@+/, '');
  return normalized ? `@${normalized}` : '';
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
