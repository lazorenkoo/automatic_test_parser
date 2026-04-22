import TelegramBot from 'node-telegram-bot-api';
import {
  createAccessCodes,
  createReusableAccessCode,
  deleteQuizById,
  getAccountingSummary,
  getDbMeta,
  getQuizById,
  getQuizReportById,
  getUploadReportById,
  listQuizReports,
  listUploadReports,
  listQuizzesForAdmin,
  revokeAccessCode,
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
    'Admin commands:',
    '/code <type> <questions> [price] <tg_user> [label]',
    '/reusecode <type> <questions> [price] <tg_user> [label]',
    '/codes <count> <type> <questions> [price] <tg_user> [label]',
    '/delcode <CODE>',
    '/sites [page] [type=1] [tg=@user] [q=text] [min_devices=2] [max_devices=5] [status=active|banned|all] [before=2026-04-20] [after=2026-04-01]',
    '/search <text>',
    '/site <id>',
    '/reports [limit]',
    '/report <id|q-12|u-7>',
    '/reportfile <id|q-12|u-7> <source|answer>',
    '/money',
    '/ban <id> or /ban <type> <N>',
    '/unban <id>',
    '/delete <id> or /delete before=YYYY-MM-DD ...',
    '/db',
    '/id',
    '/help',
  ].join('\n');

  bot.setMyCommands([
    { command: 'code', description: 'Create one code' },
    { command: 'reusecode', description: 'Create reusable code' },
    { command: 'codes', description: 'Create many codes' },
    { command: 'delcode', description: 'Disable a code' },
    { command: 'sites', description: 'List quiz sites' },
    { command: 'search', description: 'Search quiz sites' },
    { command: 'site', description: 'Show site details' },
    { command: 'reports', description: 'Latest file reports' },
    { command: 'report', description: 'Show report details' },
    { command: 'reportfile', description: 'Send reported file' },
    { command: 'money', description: 'Accounting summary' },
    { command: 'ban', description: 'Ban site(s)' },
    { command: 'unban', description: 'Unban site' },
    { command: 'delete', description: 'Delete site(s)' },
    { command: 'db', description: 'Show SQLite path' },
    { command: 'id', description: 'Show Telegram ID' },
    { command: 'help', description: 'Show help' },
  ]).catch(() => {});

  bot.onText(/^\/id(?:@[\w_]+)?$/i, async (msg) => {
    if (!isPrivateChat(msg)) {
      return;
    }

    await bot.sendMessage(msg.chat.id, [
      `Your user id: ${msg.from?.id ?? 'unknown'}`,
      `Your chat id: ${msg.chat.id}`,
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
    await bot.sendMessage(msg.chat.id, `SQLite database:\n${meta.dbPath}`);
  });

  bot.onText(/^\/money(?:@[\w_]+)?$/i, async (msg) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const summary = getAccountingSummary();
    await bot.sendMessage(msg.chat.id, [
      'Accounting:',
      `Used codes: ${summary.usedCodeCount}`,
      `Total amount: ${formatPrice(summary.totalAmount)}`,
    ].join('\n'));
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
      price: parsed.price,
    })[0];

    await bot.sendMessage(msg.chat.id, formatCreatedCodesMessage([code], parsed));
  });

  bot.onText(/^\/reusecode(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const parsed = parseSingleCodeArgs(match?.[1], 'reusecode');
    if (!parsed.ok) {
      await bot.sendMessage(msg.chat.id, parsed.error);
      return;
    }

    const code = createReusableAccessCode(parsed.label, {
      siteType: parsed.siteType,
      clientTgUsername: parsed.clientUsername,
      expectedQuestionCount: parsed.questionCount,
      price: parsed.price,
    });

    await bot.sendMessage(msg.chat.id, formatCreatedCodesMessage([code], { ...parsed, isReusable: true }));
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
      price: parsed.price,
    });

    await bot.sendMessage(msg.chat.id, formatCreatedCodesMessage(codes, parsed));
  });

  bot.onText(/^\/delcode(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const code = String(match?.[1] || '').trim();
    if (!code) {
      await bot.sendMessage(msg.chat.id, 'Format: /delcode <CODE>');
      return;
    }

    const result = revokeAccessCode(code);
    if (!result) {
      await bot.sendMessage(msg.chat.id, 'Code not found.');
      return;
    }

    await bot.sendMessage(msg.chat.id, result.alreadyRevoked ? 'Code was already disabled.' : 'Code disabled.');
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

  bot.onText(/^\/search(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const parsed = parseSearchArgs(match?.[1]);
    if (!parsed.ok) {
      await bot.sendMessage(msg.chat.id, parsed.error);
      return;
    }

    await bot.sendMessage(msg.chat.id, formatSearchResults(parsed), { disable_web_page_preview: true });
  });

  bot.onText(/^\/site(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const numericId = Number(String(match?.[1] || '').trim());
    if (!Number.isInteger(numericId) || numericId < 1) {
      await bot.sendMessage(msg.chat.id, 'Format: /site <id>');
      return;
    }

    const quiz = getQuizById(numericId);
    if (!quiz) {
      await bot.sendMessage(msg.chat.id, `Site with id ${numericId} not found.`);
      return;
    }

    await bot.sendMessage(msg.chat.id, formatSiteDetails(quiz), { disable_web_page_preview: true });
  });

  bot.onText(/^\/reports(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const limit = Math.max(1, Math.min(50, Number(String(match?.[1] || '').trim()) || 10));
    await bot.sendMessage(msg.chat.id, formatReportsList(limit), { disable_web_page_preview: true });
  });

  bot.onText(/^\/report(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const parsed = parseReportTarget(String(match?.[1] || '').trim());
    if (!parsed.ok) {
      await bot.sendMessage(msg.chat.id, parsed.error);
      return;
    }

    const report = getReportByTarget(parsed.target);
    if (!report) {
      await bot.sendMessage(msg.chat.id, `Report ${parsed.target} not found.`);
      return;
    }

    await bot.sendMessage(msg.chat.id, formatReportDetails(report), { disable_web_page_preview: true });
  });

  bot.onText(/^\/reportfile(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const parsed = parseReportFileArgs(match?.[1]);
    if (!parsed.ok) {
      await bot.sendMessage(msg.chat.id, parsed.error);
      return;
    }

    const report = getReportByTargetForFile(parsed.target, parsed.kind);
    if (!report) {
      await bot.sendMessage(msg.chat.id, `Report ${parsed.target} not found.`);
      return;
    }

    const filePath = parsed.kind === 'source' ? report.sourceUploadPath : report.answerUploadPath;
    const fileName = parsed.kind === 'source' ? report.sourceUploadName : report.answerUploadName;

    if (!filePath) {
      await bot.sendMessage(msg.chat.id, `No ${parsed.kind} file saved for report ${parsed.target}.`);
      return;
    }

    await bot.sendDocument(msg.chat.id, filePath, {
      caption: formatReportFileCaption(report, parsed.kind),
    }, {
      filename: fileName || undefined,
    });
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
        await bot.sendMessage(msg.chat.id, `Site with id ${parsed.id} not found.`);
        return;
      }

      await bot.sendMessage(msg.chat.id, `Site ${quiz.id} banned.\n${quiz.title}`);
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
        `No active sites of type ${parsed.siteType} with device count greater than ${parsed.minDevices}.`,
      );
      return;
    }

    const bannedLines = [];
    for (const quiz of candidates) {
      const bannedQuiz = setQuizBanStatusById(quiz.id, true);
      if (bannedQuiz) {
        bannedLines.push(`${bannedQuiz.id} | devices ${bannedQuiz.deviceCount || 0}`);
      }
    }

    await bot.sendMessage(msg.chat.id, [
      `Banned sites: ${bannedLines.length}`,
      ...bannedLines,
    ].join('\n'));
  });

  bot.onText(/^\/unban(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const numericId = Number(String(match?.[1] || '').trim());
    if (!Number.isInteger(numericId) || numericId < 1) {
      await bot.sendMessage(msg.chat.id, 'Format: /unban <id>');
      return;
    }

    const quiz = setQuizBanStatusById(numericId, false);
    if (!quiz) {
      await bot.sendMessage(msg.chat.id, `Site with id ${numericId} not found.`);
      return;
    }

    await bot.sendMessage(msg.chat.id, `Site ${quiz.id} is active again.\n${quiz.title}`);
  });

  bot.onText(/^\/delete(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    try {
      const parsed = parseDeleteArgs(match?.[1]);
      if (!parsed.ok) {
        await bot.sendMessage(msg.chat.id, parsed.error);
        return;
      }

      if (parsed.mode === 'single') {
        const deletedQuiz = deleteQuizById(parsed.id);
        if (!deletedQuiz) {
          await bot.sendMessage(msg.chat.id, `Site with id ${parsed.id} not found.`);
          return;
        }

        await bot.sendMessage(msg.chat.id, `Site deleted:\n${deletedQuiz.id}. ${deletedQuiz.title}`);
        return;
      }

      const candidates = listQuizzesForAdmin().filter((quiz) => matchesQuizFilters(quiz, parsed.filters));
      if (!candidates.length) {
        await bot.sendMessage(msg.chat.id, 'Nothing matched these filters.');
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
        `Deleted sites: ${deletedLines.length}`,
        '',
        ...deletedLines.slice(0, 30),
        deletedLines.length > 30 ? '...' : null,
      ].filter(Boolean).join('\n'));
    } catch (error) {
      console.error('Telegram /delete failed:', error);
      await bot.sendMessage(msg.chat.id, 'Delete failed. Check server logs.');
    }
  });

  bot.on('polling_error', (error) => {
    console.error('Telegram polling error:', error?.message || error);
  });

  bindShutdown(bot);
  return bot;
}

export async function notifyAdminAboutQuizReport(report) {
  const adminUserId = Number(process.env.TELEGRAM_ADMIN_USER_ID || 0);
  if (!botInstance || !adminUserId || !report) {
    return;
  }

  const files = [];
  if (report.sourceUploadPath) {
    files.push('source');
  }
  if (report.answerUploadPath) {
    files.push('answer');
  }

  const snapshot = report.reporterSnapshot && typeof report.reporterSnapshot === 'object'
    ? report.reporterSnapshot
    : {};

  const request = snapshot.request && typeof snapshot.request === 'object'
    ? snapshot.request
    : {};

  const message = [
    'New quiz file report',
    `Report ID: ${report.id}`,
    `Quiz ID: ${report.quizId}`,
    `Title: ${report.quizTitle || '-'}`,
    `Slug: ${report.quizSlug || '-'}`,
    `Question: ${snapshot.currentQuestion || '-'}`,
    `IP: ${request.ip || '-'}`,
    `Note: ${report.note || snapshot.note || '-'}`,
    `Files: ${files.length ? files.join(', ') : 'none'}`,
    '',
    `Open: /report ${report.id}`,
    report.sourceUploadPath ? `Source: /reportfile ${report.id} source` : null,
    report.answerUploadPath ? `Answer: /reportfile ${report.id} answer` : null,
  ].filter(Boolean).join('\n');

  await botInstance.sendMessage(adminUserId, message, { disable_web_page_preview: true });
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

function parseSingleCodeArgs(rawValue, commandName = 'code') {
  const parts = tokenizeArgs(rawValue);
  if (parts.length < 3) {
    return {
      ok: false,
      error: commandName === 'reusecode'
        ? 'Format: /reusecode <type> <questions> [price] <tg_user> [label]'
        : 'Format: /code <type> <questions> [price] <tg_user> [label]',
    };
  }

  const siteType = normalizeSiteType(parts[0]);
  const questionCount = normalizeQuestionCount(parts[1]);
  const hasExplicitPrice = parts.length >= 4 && !looksLikeTelegramUsername(parts[2]);
  const price = hasExplicitPrice ? normalizePrice(parts[2]) : 0;
  const clientUsername = normalizeClientUsername(hasExplicitPrice ? parts[3] : parts[2]);

  if (!siteType) {
    return { ok: false, error: 'Site type must be 1 or 2.' };
  }
  if (!questionCount) {
    return { ok: false, error: 'Question count must be an integer greater than 0.' };
  }
  if (price === null) {
    return { ok: false, error: 'Price must be a number 0 or greater.' };
  }
  if (!clientUsername) {
    return { ok: false, error: 'Telegram user is required, for example @ivan.' };
  }

  return {
    ok: true,
    count: 1,
    siteType,
    questionCount,
    price,
    clientUsername,
    label: parts.slice(hasExplicitPrice ? 4 : 3).join(' ').trim() || null,
  };
}

function parseBatchCodeArgs(rawValue) {
  const parts = tokenizeArgs(rawValue);
  if (parts.length < 4) {
    return {
      ok: false,
      error: 'Format: /codes <count> <type> <questions> [price] <tg_user> [label]',
    };
  }

  const count = Math.max(1, Math.min(100, Number(parts[0] || 1)));
  const siteType = normalizeSiteType(parts[1]);
  const questionCount = normalizeQuestionCount(parts[2]);
  const hasExplicitPrice = parts.length >= 5 && !looksLikeTelegramUsername(parts[3]);
  const price = hasExplicitPrice ? normalizePrice(parts[3]) : 0;
  const clientUsername = normalizeClientUsername(hasExplicitPrice ? parts[4] : parts[3]);

  if (!Number.isInteger(count) || count < 1) {
    return { ok: false, error: 'Code count must be between 1 and 100.' };
  }
  if (!siteType) {
    return { ok: false, error: 'Site type must be 1 or 2.' };
  }
  if (!questionCount) {
    return { ok: false, error: 'Question count must be an integer greater than 0.' };
  }
  if (price === null) {
    return { ok: false, error: 'Price must be a number 0 or greater.' };
  }
  if (!clientUsername) {
    return { ok: false, error: 'Telegram user is required, for example @ivan.' };
  }

  return {
    ok: true,
    count,
    siteType,
    questionCount,
    price,
    clientUsername,
    label: parts.slice(hasExplicitPrice ? 5 : 4).join(' ').trim() || null,
  };
}

function parseSitesArgs(rawValue) {
  const parts = tokenizeArgs(rawValue);
  let page = 1;
  const filters = {
    type: null,
    tg: null,
    query: '',
    minDevices: null,
    maxDevices: null,
    status: 'all',
    before: null,
    after: null,
  };

  for (const part of parts) {
    if (/^\d+$/.test(part) && page === 1) {
      page = Math.max(1, Number(part));
      continue;
    }

    const parsed = applyFilterPart(filters, part);
    if (!parsed.ok) {
      return parsed;
    }
  }

  return { ok: true, page, filters };
}

function parseSearchArgs(rawValue) {
  const query = String(rawValue || '').trim();
  if (!query) {
    return { ok: false, error: 'Format: /search <text>' };
  }

  return {
    ok: true,
    query,
    filters: {
      type: null,
      tg: null,
      query,
      minDevices: null,
      maxDevices: null,
      status: 'all',
      before: null,
      after: null,
    },
  };
}

function parseReportFileArgs(rawValue) {
  const parts = tokenizeArgs(rawValue);
  if (parts.length < 2) {
    return { ok: false, error: 'Format: /reportfile <id|q-12|u-7> <source|answer>' };
  }

  const target = String(parts[0] || '').trim();
  const kind = String(parts[1] || '').trim().toLowerCase();
  const parsedTarget = parseReportTarget(target);
  if (!parsedTarget.ok) {
    return parsedTarget;
  }
  if (!['source', 'answer'].includes(kind)) {
    return { ok: false, error: 'File type must be source or answer.' };
  }

  return { ok: true, target: parsedTarget.target, kind };
}

function parseReportTarget(rawValue) {
  const value = String(rawValue || '').trim().toLowerCase();
  if (!value) {
    return { ok: false, error: 'Format: /report <id|q-12|u-7>' };
  }

  if (/^\d+$/.test(value)) {
    return { ok: true, target: value };
  }

  if (/^[qu]-\d+$/.test(value)) {
    return { ok: true, target: value };
  }

  return { ok: false, error: 'Use report id like 12, q-12 or u-7.' };
}

function parseBanArgs(rawValue) {
  const parts = tokenizeArgs(rawValue);

  if (parts.length === 1) {
    const numericId = Number(parts[0]);
    if (!Number.isInteger(numericId) || numericId < 1) {
      return { ok: false, error: 'Format: /ban <id> or /ban <type> <N>' };
    }
    return { ok: true, mode: 'single', id: numericId };
  }

  if (parts.length === 2) {
    const siteType = normalizeSiteType(parts[0]);
    const minDevices = Number(parts[1]);
    if (!siteType) {
      return { ok: false, error: 'Site type must be 1 or 2.' };
    }
    if (!Number.isInteger(minDevices) || minDevices < 0) {
      return { ok: false, error: 'N must be an integer 0 or greater.' };
    }
    return { ok: true, mode: 'filtered', siteType, minDevices };
  }

  return { ok: false, error: 'Format: /ban <id> or /ban <type> <N>' };
}

function parseDeleteArgs(rawValue) {
  const parts = tokenizeArgs(rawValue);
  if (!parts.length) {
    return {
      ok: false,
      error: 'Format: /delete <id> or /delete before=YYYY-MM-DD [type=1] [tg=@user]',
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
    query: '',
    minDevices: null,
    maxDevices: null,
    status: 'all',
    before: null,
    after: null,
  };

  for (const part of parts) {
    const parsed = applyFilterPart(filters, part);
    if (!parsed.ok) {
      return parsed;
    }
  }

  if (!filters.before && !filters.after && !filters.type && !filters.tg && filters.minDevices === null && filters.maxDevices === null && filters.status === 'all' && !filters.query) {
    return { ok: false, error: 'Use at least one filter when deleting by query.' };
  }

  return { ok: true, mode: 'filtered', filters };
}

function applyFilterPart(filters, part) {
  const [key, value = ''] = part.split('=');
  const normalizedKey = String(key || '').trim().toLowerCase();
  const normalizedValue = String(value || '').trim();

  if (normalizedKey === 'type') {
    const siteType = normalizeSiteType(normalizedValue);
    if (!siteType) {
      return { ok: false, error: 'type supports only 1 or 2.' };
    }
    filters.type = siteType;
    return { ok: true };
  }

  if (normalizedKey === 'tg') {
    const username = normalizeClientUsername(normalizedValue);
    if (!username) {
      return { ok: false, error: 'tg must look like tg=@username.' };
    }
    filters.tg = username;
    return { ok: true };
  }

  if (normalizedKey === 'q' || normalizedKey === 'query') {
    if (!normalizedValue) {
      return { ok: false, error: 'q must contain search text.' };
    }
    filters.query = normalizedValue;
    return { ok: true };
  }

  if (normalizedKey === 'min_devices') {
    const numericValue = Number(normalizedValue);
    if (!Number.isInteger(numericValue) || numericValue < 0) {
      return { ok: false, error: 'min_devices must be an integer 0 or greater.' };
    }
    filters.minDevices = numericValue;
    return { ok: true };
  }

  if (normalizedKey === 'max_devices') {
    const numericValue = Number(normalizedValue);
    if (!Number.isInteger(numericValue) || numericValue < 0) {
      return { ok: false, error: 'max_devices must be an integer 0 or greater.' };
    }
    filters.maxDevices = numericValue;
    return { ok: true };
  }

  if (normalizedKey === 'status') {
    const normalizedStatus = normalizedValue.toLowerCase();
    if (!['active', 'banned', 'all'].includes(normalizedStatus)) {
      return { ok: false, error: 'status supports active, banned or all.' };
    }
    filters.status = normalizedStatus;
    return { ok: true };
  }

  if (normalizedKey === 'before' || normalizedKey === 'after') {
    const timestamp = normalizeDateFilter(normalizedValue);
    if (!timestamp) {
      return { ok: false, error: `${normalizedKey} must be YYYY-MM-DD.` };
    }
    filters[normalizedKey] = timestamp;
    return { ok: true };
  }

  return {
    ok: false,
    error: 'Unknown filter. Use type, tg, q, min_devices, max_devices, status, before, after.',
  };
}

function formatCreatedCodesMessage(codes, parsed) {
  const common = [
    parsed.isReusable ? 'Mode: reusable code' : null,
    parsed.label ? `Label: ${parsed.label}` : null,
    `Question count: ${parsed.questionCount}`,
  ].filter(Boolean);

  if (codes.length === 1) {
    return [
      `Code: ${codes[0]}`,
      ...common,
    ].join('\n');
  }

  return [
    `Created codes: ${codes.length}`,
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
      'No sites found.',
      filterSummary ? `Filters: ${filterSummary}` : null,
    ].filter(Boolean).join('\n');
  }

  return [
    `Sites: page ${page} of ${totalPages}`,
    `Total: ${filtered.length}`,
    filterSummary ? `Filters: ${filterSummary}` : null,
    '',
    ...items.map((quiz) => formatSiteListItem(quiz)),
    '',
    page < totalPages ? `Next: /sites ${page + 1}${filterSummary ? ` ${filterSummary}` : ''}` : 'Last page.',
  ].filter(Boolean).join('\n');
}

function formatSearchResults(parsed) {
  const allQuizzes = listQuizzesForAdmin();
  const matched = allQuizzes.filter((quiz) => matchesQuizFilters(quiz, parsed.filters));
  const items = matched.slice(0, 30);

  if (!items.length) {
    return `Nothing found for: ${parsed.query}`;
  }

  return [
    `Search: ${parsed.query}`,
    `Matches: ${matched.length}${matched.length > items.length ? '+' : ''}`,
    '',
    ...items.map((quiz) => formatSiteListItem(quiz)),
  ].join('\n');
}

function formatSiteListItem(quiz) {
  const title = String(quiz.title || '').trim() || quiz.codeLabel || `Site ${quiz.id}`;
  return `${quiz.id}. ${title} | devices ${quiz.deviceCount || 0}${formatQuizPublicStatus(quiz)}`;
}

function formatSiteDetails(quiz) {
  const devices = Array.isArray(quiz.devices) ? quiz.devices : [];
  const creatorLines = formatCreatorDetails(quiz.creatorSnapshot);
  const reports = listQuizReports(100).filter((report) => report.quizId === quiz.id);

  return [
    `Site ${quiz.id}`,
    `Title: ${quiz.title}`,
    `Slug: ${quiz.slug}`,
    `Question count: ${quiz.expectedQuestionCount || quiz.requestedCount || quiz.parsedCount || 0}`,
    `Parsed questions: ${quiz.parsedCount || 0}`,
    `Devices: ${quiz.deviceCount || 0}`,
    `Status: ${describeQuizPublicStatus(quiz)}`,
    `Created: ${formatDateTime(quiz.createdAt)}`,
    `Link expires: ${formatDateTime(quiz.expiresAt)}`,
    `Last visit: ${formatDateTime(quiz.lastSeenAt)}`,
    `Reports: ${reports.length}`,
    '',
    'Creator:',
    ...creatorLines,
    '',
    devices.length
      ? devices.slice(0, 10).map((device, index) => `${index + 1}. ${maskDeviceId(device.deviceId)} | ${formatDateTime(device.lastSeenAt)} | ${device.lastIp || 'IP ?'}`).join('\n')
      : 'No visits yet.',
  ].join('\n');
}

function formatReportsList(limit) {
  const reports = [
    ...listQuizReports(limit),
    ...listUploadReports(limit),
  ]
    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
    .slice(0, limit);

  if (!reports.length) {
    return 'No reports yet.';
  }

  return [
    `Latest reports: ${reports.length}`,
    '',
    ...reports.map((report) => `${report.id}. ${report.reportType === 'upload' ? 'main' : 'site'} | ${truncate(report.note || 'no text', 120)}`),
  ].join('\n');
}

function formatReportDetails(report) {
  const snapshot = report.reporterSnapshot && typeof report.reporterSnapshot === 'object'
    ? report.reporterSnapshot
    : {};
  const request = snapshot.request && typeof snapshot.request === 'object'
    ? snapshot.request
    : {};
  const device = snapshot.device && typeof snapshot.device === 'object'
    ? snapshot.device
    : {};

  return [
    `Report ${formatReportHandle(report)}`,
    `Type: ${report.reportType || 'quiz'}`,
    `Quiz ID: ${report.quizId || '-'}`,
    `Title: ${report.quizTitle || report.title || '-'}`,
    `Slug: ${report.quizSlug || '-'}`,
    `Created: ${formatDateTime(report.createdAt)}`,
    `Question: ${snapshot.currentQuestion || '-'}`,
    `Page: ${snapshot.pageUrl || '-'}`,
    `IP: ${request.ip || '-'}`,
    `User-Agent: ${request.userAgent || '-'}`,
    `Referrer: ${request.referer || '-'}`,
    `Device ID: ${device.deviceId ? maskDeviceId(device.deviceId) : '-'}`,
    `Note: ${report.note || snapshot.note || '-'}`,
    `Source file: ${report.sourceUploadName || '-'}`,
    `Answer file: ${report.answerUploadName || '-'}`,
    '',
    report.sourceUploadPath ? `Download source: /reportfile ${formatReportHandle(report)} source` : null,
    report.answerUploadPath ? `Download answer: /reportfile ${formatReportHandle(report)} answer` : null,
  ].filter(Boolean).join('\n');
}

function getReportByTarget(target) {
  const normalized = String(target || '').trim().toLowerCase();
  if (/^u-\d+$/.test(normalized)) {
    return getUploadReportById(normalized.slice(2));
  }

  if (/^q-\d+$/.test(normalized)) {
    return getQuizReportById(normalized.slice(2));
  }

  if (/^\d+$/.test(normalized)) {
    return getUploadReportById(normalized) || getQuizReportById(normalized);
  }

  return null;
}

function getReportByTargetForFile(target, kind) {
  const normalized = String(target || '').trim().toLowerCase();
  const hasRequestedFile = (report) => {
    if (!report) {
      return false;
    }

    return kind === 'answer' ? Boolean(report.answerUploadPath) : Boolean(report.sourceUploadPath);
  };

  if (/^u-\d+$/.test(normalized) || /^q-\d+$/.test(normalized)) {
    return getReportByTarget(normalized);
  }

  if (/^\d+$/.test(normalized)) {
    const uploadReport = getUploadReportById(normalized);
    const quizReport = getQuizReportById(normalized);

    if (hasRequestedFile(uploadReport)) {
      return uploadReport;
    }
    if (hasRequestedFile(quizReport)) {
      return quizReport;
    }

    return uploadReport || quizReport || null;
  }

  return null;
}

function formatReportHandle(report) {
  return report.reportType === 'upload' ? `u-${report.id}` : `q-${report.id}`;
}

function formatReportLabel(report) {
  if (report.reportType === 'upload') {
    return `upload | ${report.title || report.sourceUploadName || '-'}`;
  }

  return `quiz ${report.quizId} | ${report.quizTitle || '-'}`;
}

function formatReportFileCaption(report, kind) {
  if (report.reportType === 'upload') {
    return `Report ${formatReportHandle(report)} | ${kind} | upload`;
  }

  return `Report ${formatReportHandle(report)} | ${kind} | quiz ${report.quizId}`;
}

function formatCreatorDetails(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !Object.keys(snapshot).length) {
    return ['No creator trace saved.'];
  }

  const request = snapshot.request && typeof snapshot.request === 'object' ? snapshot.request : {};
  const client = snapshot.client && typeof snapshot.client === 'object' ? snapshot.client : {};
  const uaData = client.userAgentData && typeof client.userAgentData === 'object' ? client.userAgentData : {};
  const brands = Array.isArray(uaData.brands)
    ? uaData.brands.map((item) => [item.brand, item.version].filter(Boolean).join(' ')).filter(Boolean).join(', ')
    : '';
  const screen = formatScreen(client.screen);
  const viewport = formatViewport(client.viewport);
  const connection = formatConnection(client.connection);

  return [
    `Captured: ${formatDateTime(snapshot.capturedAt)}`,
    `Browser ID: ${snapshot.browserId || '-'}`,
    `Fingerprint: ${maskDeviceId(snapshot.fingerprint || '') || '-'}`,
    `Class: ${snapshot.deviceClass || '-'}`,
    `IP: ${request.ip || request.realIp || request.forwardedFor || '-'}`,
    `Lang/TZ: ${[client.language, client.timezone].filter(Boolean).join(' | ') || '-'}`,
    `Platform: ${[client.platform || uaData.platform, uaData.architecture, uaData.bitness].filter(Boolean).join(' | ') || '-'}`,
    `Browser: ${brands || request.userAgent || client.userAgent || '-'}`,
    `Screen: ${screen || '-'}`,
    `Viewport: ${viewport || '-'}`,
    `Touch/CPU/RAM: ${formatHardware(client)}`,
    `Connection: ${connection || '-'}`,
    `Source page: ${client.pageUrl || '-'}`,
    `Referrer: ${client.referrer || request.referer || '-'}`,
  ];
}

function formatScreen(screen) {
  if (!screen || typeof screen !== 'object') {
    return '';
  }
  const width = Number(screen.width || 0);
  const height = Number(screen.height || 0);
  return width && height ? `${width}x${height}` : '';
}

function formatViewport(viewport) {
  if (!viewport || typeof viewport !== 'object') {
    return '';
  }
  const width = Number(viewport.width || 0);
  const height = Number(viewport.height || 0);
  if (!width || !height) {
    return '';
  }
  const ratio = viewport.pixelRatio ? ` @${viewport.pixelRatio}` : '';
  return `${width}x${height}${ratio}`;
}

function formatHardware(client) {
  if (!client || typeof client !== 'object') {
    return '-';
  }

  const parts = [
    client.maxTouchPoints != null ? `touch ${client.maxTouchPoints}` : null,
    client.hardwareConcurrency != null ? `cpu ${client.hardwareConcurrency}` : null,
    client.deviceMemory != null ? `ram ${client.deviceMemory}` : null,
  ].filter(Boolean);

  return parts.join(' | ') || '-';
}

function formatConnection(connection) {
  if (!connection || typeof connection !== 'object') {
    return '';
  }

  return [
    connection.effectiveType || null,
    connection.downlink != null ? `${connection.downlink}Mb/s` : null,
    connection.rtt != null ? `${connection.rtt}ms` : null,
    connection.saveData === true ? 'saveData' : null,
  ].filter(Boolean).join(' | ');
}

function matchesQuizFilters(quiz, filters) {
  if (filters.type && String(quiz.siteType || '') !== String(filters.type)) {
    return false;
  }
  if (filters.tg && normalizeClientUsername(quiz.clientTgUsername) !== filters.tg) {
    return false;
  }
  if (filters.query) {
    const query = String(filters.query || '').trim().toLowerCase();
    const haystack = [
      quiz.slug,
      quiz.title,
      quiz.sourceFilename,
      quiz.clientTgUsername,
      quiz.codeLabel,
    ].map((value) => String(value || '').toLowerCase()).join(' ');
    if (!haystack.includes(query)) {
      return false;
    }
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

function formatQuizPublicStatus(quiz) {
  if (quiz.bannedAt) {
    return ' | BANNED';
  }
  if (isExpiredQuiz(quiz)) {
    return ' | EXPIRED';
  }
  return '';
}

function describeQuizPublicStatus(quiz) {
  if (quiz.bannedAt) {
    return 'banned';
  }
  if (isExpiredQuiz(quiz)) {
    return 'expired';
  }
  return 'active';
}

function isExpiredQuiz(quiz) {
  const expiresAt = Number(quiz?.expiresAt || 0);
  return expiresAt > 0 && Date.now() >= expiresAt;
}

function summarizeFilters(filters) {
  return [
    filters.type ? `type=${filters.type}` : null,
    filters.tg ? `tg=${filters.tg}` : null,
    filters.query ? `q=${filters.query}` : null,
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

function normalizePrice(value) {
  if (value == null || value === '') {
    return 0;
  }
  const normalized = String(value).trim().replace(',', '.');
  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return null;
  }
  return Math.round(numericValue * 100) / 100;
}

function normalizeClientUsername(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/^@+/, '');
  return normalized ? `@${normalized}` : '';
}

function looksLikeTelegramUsername(value) {
  return Boolean(normalizeClientUsername(value));
}

function normalizeDateFilter(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    return 0;
  }

  const date = new Date(`${value}T00:00:00`);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatPrice(value) {
  const numericValue = Number(value || 0);
  const normalized = Number.isFinite(numericValue) ? Math.round(numericValue * 100) / 100 : 0;
  return `${normalized.toFixed(2)} UAH`;
}

function formatDateTime(value) {
  if (!value) {
    return '-';
  }
  return new Date(Number(value)).toLocaleString('ru-RU');
}

function formatDateOnly(value) {
  if (!value) {
    return '';
  }
  return new Date(Number(value)).toISOString().slice(0, 10);
}

function maskDeviceId(value) {
  const text = String(value || '');
  if (text.length <= 12) {
    return text || 'device';
  }
  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

function truncate(value, maxLength) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

async function deny(bot, msg) {
  if (!isPrivateChat(msg)) {
    return;
  }
  await bot.sendMessage(msg.chat.id, 'No access to this bot.');
}

async function explainSetup(bot, msg) {
  if (!isPrivateChat(msg)) {
    return;
  }
  await bot.sendMessage(msg.chat.id, [
    'This bot is not linked to your Telegram ID yet.',
    'Send /id, put that value into TELEGRAM_ADMIN_USER_ID, then restart the server.',
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
