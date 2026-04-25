import TelegramBot from 'node-telegram-bot-api';
import {
  createAccessCodes,
  createClientAccessCode,
  createTopUpPaymentSession,
  createReusableAccessCode,
  banAiDevice,
  cancelPaymentSession,
  deleteQuizById,
  deleteQuizReportById,
  deleteUploadReportById,
  completeTopUpPaymentSession,
  getActivePaymentSession,
  getActivePaymentSessionByUser,
  getAiDeviceBan,
  getAiRuntimeSettings,
  getAiUsageStats,
  getAccountingSummary,
  getDbMeta,
  getPaymentCooldownState,
  getHomepageNotice,
  getQuizById,
  getQuizQuestionStatsByRange,
  getQuizReportById,
  getUploadReportById,
  inspectAccessCode,
  listAccessCodesByClient,
  listAiDeviceBans,
  listAiRequestLogs,
  listQuizReports,
  listUploadReports,
  listQuizzesForAdmin,
  revokeAccessCode,
  topUpAccessCode,
  setQuizBanStatusById,
  unbanAiDevice,
  clearHomepageNotice,
  updateHomepageNotice,
  updateAiRuntimeSettings,
} from './db.js';

let botInstance = null;
let shutdownBound = false;
const pendingReportDeletionByChat = new Map();
const clientFlowStateByChat = new Map();
const questionPriceMinor = Math.max(1, Number(process.env.TELEGRAM_QUESTION_PRICE_MINOR || 10) || 10);
const paymentCooldownMs = Math.max(60 * 1000, Number(process.env.TELEGRAM_PAYMENT_COOLDOWN_MS || 60 * 60 * 1000) || (60 * 60 * 1000));
const paymentSessionTtlMs = Math.max(60 * 1000, Number(process.env.TELEGRAM_PAYMENT_SESSION_MS || 15 * 60 * 1000) || (15 * 60 * 1000));
const paymentCardNumber = String(process.env.TELEGRAM_PAYMENT_CARD_NUMBER || process.env.MONOBANK_TOPUP_CARD || '').trim();
const paymentCardLabel = String(process.env.TELEGRAM_PAYMENT_CARD_LABEL || 'mono').trim();
const paymentTopUpLink = String(process.env.TELEGRAM_PAYMENT_TOPUP_LINK || process.env.MONOBANK_TOPUP_LINK || '').trim();
const monobankToken = String(process.env.MONOBANK_PERSONAL_TOKEN || '').trim();
const monobankAccount = String(process.env.MONOBANK_PERSONAL_ACCOUNT || '0').trim() || '0';

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
    '/code <questions> <tg_user>',
    '/reusecode <questions> <tg_user> [label]',
    '/codes <count> <questions> <tg_user> [label]',
    '/addcode <CODE> <questions>',
    '/delcode <CODE>',
    '/checkcode <CODE>',
    '/notice <text>',
    '/clearnotice',
    '/ai',
    '/aimode <single|double>',
    '/aicode <on|off>',
    '/ailimit <N|off>',
    '/ailogs <count>',
    '/ainovisit [limit]',
    '/aiban <browserId> [reason]',
    '/aiunban <browserId>',
    '/aibans [limit]',
    '/sites [page] [type=1] [tg=@user] [q=text] [ai=yes|no] [visited=yes|no] [min_devices=2] [max_devices=5] [status=active|banned|all] [before=2026-04-20] [after=2026-04-01]',
    '/search <text>',
    '/site <id>',
    '/sitecount <fromId> <toId>',
    '/sitejson <id>',
    '/reports [limit]',
    '/report <id|q-12|u-7>',
    '/reportfile <id|q-12|u-7> <source|answer>',
    '/delreport <id|q-12|u-7>',
    '/money',
    '/ban <id> or /ban <type> <N>',
    '/unban <id>',
    '/delete <id> or /delete before=YYYY-MM-DD ...',
    '/db',
    '/id',
    '/help',
  ].join('\n');

  const clientCommands = [
    { command: 'start', description: 'Open menu' },
    { command: 'createcode', description: 'Create new code' },
    { command: 'mycodes', description: 'Show my codes' },
    { command: 'topup', description: 'Top up code' },
    { command: 'cancel', description: 'Cancel current action' },
    { command: 'id', description: 'Show Telegram ID' },
  ];
  const adminCommands = [
    { command: 'code', description: 'Create one code' },
    { command: 'reusecode', description: 'Create reusable code' },
    { command: 'codes', description: 'Create many codes' },
    { command: 'addcode', description: 'Top up code balance' },
    { command: 'delcode', description: 'Disable a code' },
    { command: 'checkcode', description: 'Check code status' },
    { command: 'notice', description: 'Set homepage notice' },
    { command: 'clearnotice', description: 'Clear homepage notice' },
    { command: 'ai', description: 'Show AI status' },
    { command: 'aimode', description: 'Set AI mode single/double' },
    { command: 'aicode', description: 'Require code for AI on/off' },
    { command: 'ailimit', description: 'Set AI daily limit' },
    { command: 'ailogs', description: 'Export AI request logs' },
    { command: 'ainovisit', description: 'AI sites with no visits' },
    { command: 'aiban', description: 'Ban AI device by browserId' },
    { command: 'aiunban', description: 'Unban AI device' },
    { command: 'aibans', description: 'List AI device bans' },
    { command: 'sites', description: 'List quiz sites' },
    { command: 'search', description: 'Search quiz sites' },
    { command: 'site', description: 'Show site details' },
    { command: 'sitecount', description: 'Sum questions for site id range' },
    { command: 'sitejson', description: 'Send parsed quiz JSON' },
    { command: 'reports', description: 'Latest file reports' },
    { command: 'report', description: 'Show report details' },
    { command: 'reportfile', description: 'Send reported file' },
    { command: 'delreport', description: 'Delete report' },
    { command: 'money', description: 'Accounting summary' },
    { command: 'ban', description: 'Ban site(s)' },
    { command: 'unban', description: 'Unban site' },
    { command: 'delete', description: 'Delete site(s)' },
    { command: 'db', description: 'Show SQLite path' },
    { command: 'id', description: 'Show Telegram ID' },
    { command: 'help', description: 'Show help' },
  ];

  bot.setMyCommands(clientCommands).catch(() => {});
  if (adminUserId) {
    bot.setMyCommands(adminCommands, {
      scope: {
        type: 'chat',
        chat_id: adminUserId,
      },
    }).catch(() => {});
  }

  bot.onText(/^\/id(?:@[\w_]+)?$/i, async (msg) => {
    if (!isPrivateChat(msg)) {
      return;
    }

    await bot.sendMessage(msg.chat.id, [
      `Your user id: ${msg.from?.id ?? 'unknown'}`,
      `Your chat id: ${msg.chat.id}`,
    ].join('\n'));
  });

  bot.onText(/^\/createcode(?:@[\w_]+)?$/i, async (msg) => {
    if (!isPrivateChat(msg) || Number(msg.from?.id || 0) === adminUserId) {
      return;
    }

    await handleClientCreateCode(bot, msg);
  });

  bot.onText(/^\/mycodes(?:@[\w_]+)?$/i, async (msg) => {
    if (!isPrivateChat(msg) || Number(msg.from?.id || 0) === adminUserId) {
      return;
    }

    await sendClientCodes(bot, msg.chat.id, msg.from);
  });

  bot.onText(/^\/topup(?:@[\w_]+)?$/i, async (msg) => {
    if (!isPrivateChat(msg) || Number(msg.from?.id || 0) === adminUserId) {
      return;
    }

    await startClientTopUpFlow(bot, msg.chat.id, msg.from);
  });

  bot.onText(/^\/cancel(?:@[\w_]+)?$/i, async (msg) => {
    if (!isPrivateChat(msg) || Number(msg.from?.id || 0) === adminUserId) {
      return;
    }

    await cancelClientFlow(bot, msg.chat.id, msg.from, true);
  });

  bot.on('callback_query', async (query) => {
    const msg = query.message;
    if (!msg || !isPrivateChat(msg) || Number(query.from?.id || 0) === adminUserId) {
      return;
    }

    const data = String(query.data || '');
    try {
      if (data === 'client:confirm_topup') {
        await bot.answerCallbackQuery(query.id);
        await handleClientTopUpConfirmation(bot, msg.chat.id, query.from);
        return;
      }

      if (data === 'client:cancel_topup') {
        await bot.answerCallbackQuery(query.id);
        await cancelClientFlow(bot, msg.chat.id, query.from, true);
        return;
      }

      if (data === 'client:paid_topup') {
        await bot.answerCallbackQuery(query.id, { text: 'Проверяю оплату...' }).catch(() => {});
        await handleClientPaidConfirmation(bot, msg.chat.id, query.from);
        return;
      }

      if (data === 'client:refresh_codes') {
        await bot.answerCallbackQuery(query.id);
        await sendClientCodes(bot, msg.chat.id, query.from);
      }
    } catch (error) {
      await bot.sendMessage(msg.chat.id, error.message || 'Не удалось обработать действие.');
    }
  });

  bot.on('message', async (msg) => {
    if (!isPrivateChat(msg) || Number(msg.from?.id || 0) === adminUserId) {
      return;
    }

    const text = String(msg.text || '').trim();
    if (!text || text.startsWith('/')) {
      return;
    }

    if (text === 'Создать код') {
      await handleClientCreateCode(bot, msg);
      return;
    }

    if (text === 'Пополнить код') {
      await startClientTopUpFlow(bot, msg.chat.id, msg.from);
      return;
    }

    if (text === 'Мои коды') {
      await sendClientCodes(bot, msg.chat.id, msg.from);
      return;
    }

    if (text === 'Отмена') {
      await cancelClientFlow(bot, msg.chat.id, msg.from, true);
      return;
    }

    await handleClientStateMessage(bot, msg);
  });

  bot.onText(/^\/(?:start|help)(?:@[\w_]+)?$/i, async (msg) => {
    if (!isPrivateChat(msg)) {
      return;
    }

    if (Number(msg.from?.id || 0) === adminUserId) {
      if (!(await ensureAuthorized(bot, msg, adminUserId))) {
        return;
      }
      await bot.sendMessage(msg.chat.id, helpText);
      return;
    }

    await sendClientHome(bot, msg.chat.id, msg.from);
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
      `Consumed questions: ${summary.consumedQuestionCount}`,
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
      remainingQuestionCount: parsed.questionCount,
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
      remainingQuestionCount: parsed.questionCount,
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
      remainingQuestionCount: parsed.questionCount,
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

  bot.onText(/^\/addcode(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const parsed = parseTopUpCodeArgs(match?.[1]);
    if (!parsed.ok) {
      await bot.sendMessage(msg.chat.id, parsed.error);
      return;
    }

    const result = topUpAccessCode(parsed.code, parsed.questionCount);
    if (!result) {
      await bot.sendMessage(msg.chat.id, 'Code not found or already revoked.');
      return;
    }

    await bot.sendMessage(msg.chat.id, [
      `Code: ${parsed.code}`,
      `Added: ${parsed.questionCount}`,
      `Remaining: ${result.remainingQuestionCount ?? 'unlimited'}`,
      `Total credited: ${result.expectedQuestionCount ?? 'unlimited'}`,
      `TG: ${result.clientTgUsername || '-'}`,
    ].join('\n'));
  });

  bot.onText(/^\/checkcode(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const code = String(match?.[1] || '').trim();
    if (!code) {
      await bot.sendMessage(msg.chat.id, 'Format: /checkcode <CODE>');
      return;
    }

    const result = inspectAccessCode(code);
    if (!result) {
      await bot.sendMessage(msg.chat.id, 'Code not found or already revoked.');
      return;
    }

    await bot.sendMessage(msg.chat.id, formatAccessCodeStatus(code, result));
  });

  bot.onText(/^\/notice(?:@[\w_]+)?(?:\s+([\s\S]+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const text = String(match?.[1] || '').trim();
    if (!text) {
      const current = getHomepageNotice();
      if (!current.message) {
        await bot.sendMessage(msg.chat.id, 'Homepage notice is empty.\nFormat: /notice <text>');
        return;
      }

      await bot.sendMessage(msg.chat.id, formatHomepageNotice(current, 'Current homepage notice:'));
      return;
    }

    const updated = updateHomepageNotice(text);
    await bot.sendMessage(msg.chat.id, formatHomepageNotice(updated, 'Homepage notice updated:'));
  });

  bot.onText(/^\/clearnotice(?:@[\w_]+)?$/i, async (msg) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    clearHomepageNotice();
    await bot.sendMessage(msg.chat.id, 'Homepage notice cleared.');
  });

  bot.onText(/^\/ai(?:@[\w_]+)?$/i, async (msg) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    await bot.sendMessage(msg.chat.id, formatAiRuntimeStatus());
  });

  bot.onText(/^\/aimode(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const parsed = parseAiModeCommand(match?.[1]);
    if (!parsed.ok) {
      await bot.sendMessage(msg.chat.id, parsed.error);
      return;
    }

    const settings = updateAiRuntimeSettings({ mode: parsed.value });
    await bot.sendMessage(msg.chat.id, [
      `AI mode: ${settings.mode.toUpperCase()}`,
      formatAiRuntimeStatus(),
    ].join('\n\n'));
  });

  bot.onText(/^\/aicode(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const parsed = parseToggleCommand(match?.[1], '/aicode <on|off>');
    if (!parsed.ok) {
      await bot.sendMessage(msg.chat.id, parsed.error);
      return;
    }

    const settings = updateAiRuntimeSettings({ requireCode: parsed.value });
    await bot.sendMessage(msg.chat.id, [
      `AI code requirement: ${settings.requireCode ? 'ON' : 'OFF'}`,
      formatAiRuntimeStatus(),
    ].join('\n\n'));
  });

  bot.onText(/^\/ailimit(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const parsed = parseAiLimitCommand(match?.[1]);
    if (!parsed.ok) {
      await bot.sendMessage(msg.chat.id, parsed.error);
      return;
    }

    const settings = updateAiRuntimeSettings({ dailyLimit: parsed.value });
    await bot.sendMessage(msg.chat.id, [
      `AI daily limit: ${settings.dailyLimit > 0 ? settings.dailyLimit : 'OFF'}`,
      formatAiRuntimeStatus(),
    ].join('\n\n'));
  });

  bot.onText(/^\/ailogs(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const parsed = parseRequiredLimit(match?.[1], '/ailogs <count>', 100);
    if (!parsed.ok) {
      await bot.sendMessage(msg.chat.id, parsed.error);
      return;
    }

    const content = formatAiLogsText(parsed.limit);
    const filename = `ai-logs-last-${parsed.limit}.txt`;
    await bot.sendDocument(
      msg.chat.id,
      Buffer.from(content, 'utf8'),
      {},
      { filename, contentType: 'text/plain' },
    );
  });

  bot.onText(/^\/ainovisit(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const limit = normalizeOptionalLimit(match?.[1], 20, 100);
    await bot.sendMessage(msg.chat.id, formatAiNoVisitSites(limit));
  });

  bot.onText(/^\/aiban(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const parsed = parseAiBanArgs(match?.[1], '/aiban <browserId> [reason]');
    if (!parsed.ok) {
      await bot.sendMessage(msg.chat.id, parsed.error);
      return;
    }

    const result = banAiDevice(parsed.browserId, parsed.reason);
    await bot.sendMessage(msg.chat.id, formatAiBanEntry(result, 'AI device banned.'));
  });

  bot.onText(/^\/aiunban(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const browserId = String(match?.[1] || '').trim();
    if (!browserId) {
      await bot.sendMessage(msg.chat.id, 'Format: /aiunban <browserId>');
      return;
    }

    const removed = unbanAiDevice(browserId);
    await bot.sendMessage(msg.chat.id, removed ? 'AI device unbanned.' : 'AI device ban not found.');
  });

  bot.onText(/^\/aibans(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const limit = normalizeOptionalLimit(match?.[1], 20, 100);
    await bot.sendMessage(msg.chat.id, formatAiBans(limit));
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

  bot.onText(/^\/sitecount(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const parsed = parseSiteCountArgs(match?.[1]);
    if (!parsed.ok) {
      await bot.sendMessage(msg.chat.id, parsed.error);
      return;
    }

    const stats = getQuizQuestionStatsByRange(parsed.startQuizId, parsed.endQuizId);
    if (!stats) {
      await bot.sendMessage(msg.chat.id, 'Format: /sitecount <fromId> <toId>');
      return;
    }

    await bot.sendMessage(msg.chat.id, formatSiteCountStats(stats));
  });

  bot.onText(/^\/sitejson(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const numericId = Number(String(match?.[1] || '').trim());
    if (!Number.isInteger(numericId) || numericId < 1) {
      await bot.sendMessage(msg.chat.id, 'Format: /sitejson <id>');
      return;
    }

    const quiz = getQuizById(numericId);
    if (!quiz) {
      await bot.sendMessage(msg.chat.id, `Site with id ${numericId} not found.`);
      return;
    }

    const exportPayload = {
      title: quiz.title,
      slug: quiz.slug,
      questions: quiz.questions,
      reviewBlocks: quiz.reviewBlocks || [],
      rawModelJson: quiz.rawModelJson || {},
      exportedAt: new Date().toISOString(),
    };

    const fileBuffer = Buffer.from(JSON.stringify(exportPayload, null, 2), 'utf8');
    await bot.sendDocument(msg.chat.id, fileBuffer, {
      caption: `Parsed JSON for site ${quiz.id}`,
    }, {
      filename: `quiz-${quiz.id}.json`,
      contentType: 'application/json',
    });
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

    pendingReportDeletionByChat.set(msg.chat.id, {
      target: formatReportHandle(report),
      reportType: report.reportType || 'quiz',
      reportId: report.id,
    });

    await bot.sendMessage(msg.chat.id, `Удалить репорт ${formatReportHandle(report)}?\nНапиши +`);
  });

  bot.onText(/^\/delreport(?:@[\w_]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await ensureAuthorized(bot, msg, adminUserId))) {
      return;
    }

    const parsed = parseReportTarget(String(match?.[1] || '').trim());
    if (!parsed.ok) {
      await bot.sendMessage(msg.chat.id, 'Format: /delreport <id|q-12|u-7>');
      return;
    }

    const report = getReportByTarget(parsed.target);
    if (!report) {
      await bot.sendMessage(msg.chat.id, `Репорт ${parsed.target} не найден.`);
      return;
    }

    const deleted = report.reportType === 'upload'
      ? deleteUploadReportById(report.id)
      : deleteQuizReportById(report.id);

    if (!deleted) {
      await bot.sendMessage(msg.chat.id, `Репорт ${parsed.target} не найден.`);
      return;
    }

    pendingReportDeletionByChat.delete(msg.chat.id);
    await bot.sendMessage(msg.chat.id, `Репорт ${formatReportHandle(report)} удален.`);
  });

  bot.on('message', async (msg) => {
    if (!isPrivateChat(msg) || Number(msg.from?.id || 0) !== adminUserId) {
      return;
    }

    const text = String(msg.text || '').trim();
    if (text !== '+') {
      return;
    }

    const pending = pendingReportDeletionByChat.get(msg.chat.id);
    if (!pending) {
      return;
    }

    pendingReportDeletionByChat.delete(msg.chat.id);
    const deleted = pending.reportType === 'upload'
      ? deleteUploadReportById(pending.reportId)
      : deleteQuizReportById(pending.reportId);

    if (!deleted) {
      await bot.sendMessage(msg.chat.id, `Репорт ${pending.target} уже не найден.`);
      return;
    }

    await bot.sendMessage(msg.chat.id, `Репорт ${pending.target} удален.`);
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

      if (parsed.mode === 'list') {
        const deletedLines = [];
        const missingIds = [];

        for (const id of parsed.ids) {
          const deletedQuiz = deleteQuizById(id);
          if (deletedQuiz) {
            deletedLines.push(`${deletedQuiz.id}. ${deletedQuiz.title}`);
          } else {
            missingIds.push(id);
          }
        }

        await bot.sendMessage(msg.chat.id, [
          `Deleted sites: ${deletedLines.length}`,
          missingIds.length ? `Not found: ${missingIds.join(', ')}` : null,
          '',
          ...deletedLines.slice(0, 30),
          deletedLines.length > 30 ? '...' : null,
        ].filter(Boolean).join('\n'));
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

function getClientMenuKeyboard() {
  return {
    keyboard: [
      [{ text: 'Создать код' }, { text: 'Пополнить код' }],
      [{ text: 'Мои коды' }, { text: 'Отмена' }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

async function sendClientHome(bot, chatId, from) {
  const activeSession = getActivePaymentSessionByUser(from?.id);
  const lines = ['Выберите действие.'];

  if (activeSession) {
    lines.push(`Есть активная оплата до ${formatDateTime(activeSession.expiresAt)}.`);
  }

  await bot.sendMessage(chatId, lines.join('\n'), {
    reply_markup: getClientMenuKeyboard(),
  });
}

async function handleClientCreateCode(bot, msg) {
  const code = createClientAccessCode({
    clientTgUserId: msg.from?.id,
    clientTgUsername: msg.from?.username,
  });

  await bot.sendMessage(msg.chat.id, [
    'Новый код создан.',
    `Код: ${code}`,
    'Сейчас в нём 0 вопросов.',
  ].join('\n'), {
    reply_markup: getClientMenuKeyboard(),
  });
}

async function sendClientCodes(bot, chatId, from) {
  const codes = listAccessCodesByClient({
    clientTgUserId: from?.id,
    clientTgUsername: from?.username,
  });

  if (!codes.length) {
    await bot.sendMessage(chatId, 'У вас пока нет кодов. Нажмите "Создать код".', {
      reply_markup: getClientMenuKeyboard(),
    });
    return;
  }

  const lines = [
    'Ваши коды:',
    '',
    ...codes.map((code, index) => [
      `${index + 1}. ${code.label || `Код #${code.id}`}`,
      `Осталось вопросов: ${code.remainingQuestionCount ?? 'unlimited'}`,
    ].join('\n')),
  ];

  await bot.sendMessage(chatId, lines.join('\n\n'), {
    reply_markup: {
      inline_keyboard: [[{ text: 'Обновить', callback_data: 'client:refresh_codes' }]],
    },
  });
}

async function startClientTopUpFlow(bot, chatId, from) {
  const activeOwnSession = getActivePaymentSessionByUser(from?.id);
  if (activeOwnSession) {
    await sendPaymentInstructions(bot, chatId, activeOwnSession);
    return;
  }

  const codes = listAccessCodesByClient({
    clientTgUserId: from?.id,
    clientTgUsername: from?.username,
  });
  if (!codes.length) {
    await bot.sendMessage(chatId, 'Сначала создайте код, а потом уже пополняйте его.', {
      reply_markup: getClientMenuKeyboard(),
    });
    return;
  }

  clientFlowStateByChat.set(chatId, {
    step: 'await_topup_code',
    fromUserId: Number(from?.id || 0),
  });

  await bot.sendMessage(chatId, 'Отправьте код, который хотите пополнить.', {
    reply_markup: getClientMenuKeyboard(),
  });
}

async function cancelClientFlow(bot, chatId, from, notify = false) {
  clientFlowStateByChat.delete(chatId);
  const activeSession = getActivePaymentSessionByUser(from?.id);
  if (activeSession) {
    cancelPaymentSession(activeSession.id, 'cancelled_by_user');
  }

  if (notify) {
    await bot.sendMessage(chatId, 'Текущее действие отменено.', {
      reply_markup: getClientMenuKeyboard(),
    });
  }
}

async function handleClientStateMessage(bot, msg) {
  const state = clientFlowStateByChat.get(msg.chat.id);
  if (!state || state.fromUserId !== Number(msg.from?.id || 0)) {
    return;
  }

  if (state.step === 'await_topup_code') {
    const code = String(msg.text || '').trim();
    const details = inspectAccessCode(code);
    const ownerMatches = isCodeOwnedByClient(details, msg.from);
    if (!details || !ownerMatches) {
      await bot.sendMessage(msg.chat.id, 'Код не найден или он не привязан к вашему Telegram.');
      return;
    }

    clientFlowStateByChat.set(msg.chat.id, {
      ...state,
      step: 'await_topup_question_count',
      targetCode: code,
    });
    await bot.sendMessage(msg.chat.id, 'Сколько вопросов хотите купить? Введите целое число больше 0.');
    return;
  }

  if (state.step === 'await_topup_question_count') {
    const questionCount = normalizeQuestionCount(msg.text);
    if (!questionCount) {
      await bot.sendMessage(msg.chat.id, 'Введите целое число больше 0.');
      return;
    }

    const amountMinor = questionCount * questionPriceMinor;
    clientFlowStateByChat.set(msg.chat.id, {
      ...state,
      step: 'await_topup_confirm',
      questionCount,
      amountMinor,
    });

    await bot.sendMessage(msg.chat.id, [
      'Проверьте данные:',
      `Код: ${state.targetCode}`,
      `Вопросов: ${questionCount}`,
      `Цена: ${formatMinorPrice(amountMinor)}`,
      '',
      'Если всё верно, подтвердите оплату.',
    ].join('\n'), {
      reply_markup: {
        inline_keyboard: [[
          { text: 'Подтвердить', callback_data: 'client:confirm_topup' },
          { text: 'Отмена', callback_data: 'client:cancel_topup' },
        ]],
      },
    });
  }
}

async function handleClientTopUpConfirmation(bot, chatId, from) {
  const state = clientFlowStateByChat.get(chatId);
  if (!state || state.fromUserId !== Number(from?.id || 0) || state.step !== 'await_topup_confirm') {
    await bot.sendMessage(chatId, 'Сначала начните пополнение заново.');
    return;
  }

  const cooldown = getPaymentCooldownState({
    tgUserId: from?.id,
    cooldownMs: paymentCooldownMs,
  });
  if (!cooldown.allowed) {
    await bot.sendMessage(chatId, `Новое пополнение можно начать после ${formatDateTime(cooldown.nextAllowedAt)}.`);
    return;
  }

  const created = createTopUpPaymentSession({
    tgUserId: from?.id,
    tgUsername: from?.username,
    targetCode: state.targetCode,
    questionCount: state.questionCount,
    amountMinor: state.amountMinor,
    ttlMs: paymentSessionTtlMs,
  });

  if (!created?.ok) {
    if (created?.error === 'busy' && created.activeSession) {
      await bot.sendMessage(chatId, [
        'Сейчас другой клиент находится в оплате.',
        `Попробуйте после ${formatDateTime(created.activeSession.expiresAt)}.`,
      ].join('\n'));
      return;
    }

    await bot.sendMessage(chatId, 'Не удалось открыть оплату. Попробуйте ещё раз позже.');
    return;
  }

  clientFlowStateByChat.delete(chatId);
  await sendPaymentInstructions(bot, chatId, created.session);
}

async function handleClientPaidConfirmation(bot, chatId, from) {
  const session = getActivePaymentSessionByUser(from?.id);
  if (!session) {
    await bot.sendMessage(chatId, 'Активной оплаты не найдено. Начните пополнение заново.');
    return;
  }

  if (!monobankToken) {
    await bot.sendMessage(chatId, 'На сервере не настроен токен monobank для проверки оплаты.');
    return;
  }

  const matchedItem = await findMatchingMonobankPayment({
    createdAt: session.createdAt,
    amountMinor: session.amountMinor,
  });

  if (!matchedItem) {
    await bot.sendMessage(chatId, [
      'Платёж пока не найден.',
      'Если вы оплатили только что, подождите немного и нажмите "Я оплатил" ещё раз.',
    ].join('\n'));
    return;
  }

  const completed = completeTopUpPaymentSession(session.id, matchedItem.id);
  if (!completed?.code) {
    await bot.sendMessage(chatId, 'Не удалось завершить пополнение. Напишите администратору.');
    return;
  }

  await bot.sendMessage(chatId, [
    'Оплата найдена, код пополнен.',
    `Код: ${completed.session.targetCode}`,
    `Начислено вопросов: ${completed.session.questionCount}`,
    `Теперь осталось: ${completed.code.remainingQuestionCount ?? 'unlimited'}`,
  ].join('\n'), {
    reply_markup: getClientMenuKeyboard(),
  });
}

async function sendPaymentInstructions(bot, chatId, session) {
  const lines = [
    'Оплатите пополнение по реквизитам ниже.',
    `Сумма: ${formatMinorPrice(session.amountMinor)}`,
    `Код: ${session.targetCode}`,
    `Вопросов: ${session.questionCount}`,
    `Действует до: ${formatDateTime(session.expiresAt)}`,
  ];

  if (session.amountMinor >= 10000 && paymentTopUpLink) {
    lines.push(`Ссылка на пополнение: ${paymentTopUpLink}`);
  } else if (paymentCardNumber) {
    lines.push(`${paymentCardLabel}: ${paymentCardNumber}`);
  } else {
    lines.push('Реквизиты для оплаты не настроены в .env.');
  }

  lines.push('', 'После перевода нажмите "Я оплатил".');

  await bot.sendMessage(chatId, lines.join('\n'), {
    reply_markup: {
      inline_keyboard: [[
        { text: 'Я оплатил', callback_data: 'client:paid_topup' },
        { text: 'Отмена', callback_data: 'client:cancel_topup' },
      ]],
    },
  });
}

async function findMatchingMonobankPayment({ createdAt, amountMinor }) {
  const fromUnix = Math.max(0, Math.floor((Number(createdAt || 0) - (5 * 60 * 1000)) / 1000));
  const url = `https://api.monobank.ua/personal/statement/${encodeURIComponent(monobankAccount)}/${fromUnix}`;
  const response = await fetch(url, {
    headers: {
      'X-Token': monobankToken,
    },
  });

  if (!response.ok) {
    throw new Error(`Monobank statement check failed: ${response.status}`);
  }

  const items = await response.json();
  if (!Array.isArray(items)) {
    return null;
  }

  return items.find((item) => {
    const amount = Number(item?.amount || 0);
    const timeMs = Number(item?.time || 0) * 1000;
    return item?.id && amount === Number(amountMinor || 0) && amount > 0 && timeMs >= Number(createdAt || 0) - 60 * 1000;
  }) || null;
}

function isCodeOwnedByClient(code, from) {
  if (!code) {
    return false;
  }

  const numericUserId = Number(from?.id || 0);
  const username = normalizeClientUsername(from?.username);
  if (code.clientTgUserId && code.clientTgUserId === numericUserId) {
    return true;
  }

  return Boolean(username && code.clientTgUsername === username);
}

function formatMinorPrice(value) {
  const amountMinor = Number(value || 0);
  return `${(amountMinor / 100).toFixed(2)} грн`;
}

function formatClientDisplayName(from) {
  if (from?.first_name) {
    return from.first_name;
  }
  if (from?.username) {
    return `@${from.username.replace(/^@+/, '')}`;
  }
  return 'друг';
}


export async function sendAdminTelegramLog(message) {
  const bot = botInstance || startTelegramBot();
  const adminUserId = Number(process.env.TELEGRAM_ADMIN_USER_ID || 0);
  const text = String(message || '').trim();

  if (!bot || !adminUserId || !text) {
    return false;
  }

  try {
    await bot.sendMessage(adminUserId, text);
    return true;
  } catch {
    return false;
  }
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
  if (commandName === 'code' || commandName === 'reusecode') {
    if (parts.length < 2) {
      return {
        ok: false,
        error: commandName === 'reusecode'
          ? 'Format: /reusecode <questions> <tg_user> [label]'
          : 'Format: /code <questions> <tg_user> [label]',
      };
    }

    const questionCount = normalizeQuestionCount(parts[0]);
    const clientUsername = normalizeClientUsername(parts[1]);

    if (!questionCount) {
      return { ok: false, error: 'Question count must be an integer greater than 0.' };
    }
    if (!clientUsername) {
      return { ok: false, error: 'Telegram user is required, for example @ivan.' };
    }

    return {
      ok: true,
      count: 1,
      siteType: null,
      questionCount,
      price: 0,
      clientUsername,
      label: parts.slice(2).join(' ').trim() || null,
    };
  }

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
  if (parts.length >= 3 && !normalizeSiteType(parts[1])) {
    const count = Math.max(1, Math.min(100, Number(parts[0] || 1)));
    const questionCount = normalizeQuestionCount(parts[1]);
    const clientUsername = normalizeClientUsername(parts[2]);

    if (!Number.isInteger(count) || count < 1) {
      return { ok: false, error: 'Code count must be between 1 and 100.' };
    }
    if (!questionCount) {
      return { ok: false, error: 'Question count must be an integer greater than 0.' };
    }
    if (!clientUsername) {
      return { ok: false, error: 'Telegram user is required, for example @ivan.' };
    }

    return {
      ok: true,
      count,
      siteType: null,
      questionCount,
      price: 0,
      clientUsername,
      label: parts.slice(3).join(' ').trim() || null,
    };
  }

  if (parts.length < 4) {
    return {
      ok: false,
      error: 'Format: /codes <count> <questions> <tg_user> [label]',
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

function parseTopUpCodeArgs(rawValue) {
  const parts = tokenizeArgs(rawValue);
  if (parts.length < 2) {
    return { ok: false, error: 'Format: /addcode <CODE> <questions>' };
  }

  const code = String(parts[0] || '').trim();
  const questionCount = normalizeQuestionCount(parts[1]);
  if (!code) {
    return { ok: false, error: 'Format: /addcode <CODE> <questions>' };
  }
  if (!questionCount) {
    return { ok: false, error: 'Question count must be an integer greater than 0.' };
  }

  return {
    ok: true,
    code,
    questionCount,
  };
}

function parseSitesArgs(rawValue) {
  const parts = tokenizeArgs(rawValue);
  let page = 1;
  const filters = {
    type: null,
    tg: null,
    query: '',
    ai: null,
    visited: null,
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
      ai: null,
      visited: null,
      minDevices: null,
      maxDevices: null,
      status: 'all',
      before: null,
      after: null,
    },
  };
}

function parseSiteCountArgs(rawValue) {
  const parts = String(rawValue || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length !== 2) {
    return { ok: false, error: 'Format: /sitecount <fromId> <toId>' };
  }

  const startQuizId = Number(parts[0]);
  const endQuizId = Number(parts[1]);
  if (!Number.isInteger(startQuizId) || !Number.isInteger(endQuizId) || startQuizId < 1 || endQuizId < 1) {
    return { ok: false, error: 'Format: /sitecount <fromId> <toId>' };
  }

  return {
    ok: true,
    startQuizId,
    endQuizId,
  };
}

function parseToggleCommand(rawValue, formatHint) {
  const value = String(rawValue || '').trim().toLowerCase();
  if (value === 'on' || value === '1' || value === 'true') {
    return { ok: true, value: true };
  }
  if (value === 'off' || value === '0' || value === 'false') {
    return { ok: true, value: false };
  }

  return { ok: false, error: `Format: ${formatHint}` };
}

function parseAiModeCommand(rawValue) {
  const value = String(rawValue || '').trim().toLowerCase();
  if (value === 'single' || value === 'double') {
    return { ok: true, value };
  }

  return { ok: false, error: 'Format: /aimode <single|double>' };
}

function parseAiLimitCommand(rawValue) {
  const value = String(rawValue || '').trim().toLowerCase();
  if (!value) {
    return { ok: false, error: 'Format: /ailimit <N|off>' };
  }

  if (value === 'off' || value === 'none' || value === 'unlimited') {
    return { ok: true, value: 0 };
  }

  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 0) {
    return { ok: false, error: 'Format: /ailimit <N|off>' };
  }

  return { ok: true, value: numericValue };
}

function parseAiBanArgs(rawValue, formatHint) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return { ok: false, error: `Format: ${formatHint}` };
  }

  const parts = tokenizeArgs(value);
  const browserId = String(parts[0] || '').trim();
  if (!browserId) {
    return { ok: false, error: `Format: ${formatHint}` };
  }

  return {
    ok: true,
    browserId,
    reason: parts.slice(1).join(' ').trim() || null,
  };
}

function normalizeOptionalLimit(rawValue, fallbackValue = 20, maxValue = 100) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return fallbackValue;
  }

  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 1) {
    return fallbackValue;
  }

  return Math.min(maxValue, numericValue);
}

function parseRequiredLimit(rawValue, formatHint, maxValue = 100) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return { ok: false, error: `Format: ${formatHint}` };
  }

  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 1) {
    return { ok: false, error: `Format: ${formatHint}` };
  }

  return {
    ok: true,
    limit: Math.min(maxValue, numericValue),
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
  const rawText = String(rawValue || '').trim();
  const parts = tokenizeArgs(rawValue);
  if (!parts.length) {
    return {
      ok: false,
      error: 'Format: /delete <id> | /delete <id1,id2,id3> | /delete before=YYYY-MM-DD [type=1] [tg=@user]',
    };
  }

  if (/^\d+(?:\s*,\s*\d+)+$/.test(rawText)) {
    const ids = rawText
      .split(',')
      .map((part) => Number(String(part || '').trim()))
      .filter((value) => Number.isInteger(value) && value > 0);

    if (!ids.length) {
      return {
        ok: false,
        error: 'Format: /delete <id> | /delete <id1,id2,id3> | /delete before=YYYY-MM-DD [type=1] [tg=@user]',
      };
    }

    return {
      ok: true,
      mode: 'list',
      ids: [...new Set(ids)],
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
    ai: null,
    visited: null,
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

  if (!filters.before && !filters.after && !filters.type && !filters.tg && filters.ai === null && filters.visited === null && filters.minDevices === null && filters.maxDevices === null && filters.status === 'all' && !filters.query) {
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

  if (normalizedKey === 'ai') {
    const normalizedAi = normalizedValue.toLowerCase();
    if (!['yes', 'no'].includes(normalizedAi)) {
      return { ok: false, error: 'ai supports yes or no.' };
    }
    filters.ai = normalizedAi === 'yes';
    return { ok: true };
  }

  if (normalizedKey === 'visited') {
    const normalizedVisited = normalizedValue.toLowerCase();
    if (!['yes', 'no'].includes(normalizedVisited)) {
      return { ok: false, error: 'visited supports yes or no.' };
    }
    filters.visited = normalizedVisited === 'yes';
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
    error: 'Unknown filter. Use type, tg, q, ai, visited, min_devices, max_devices, status, before, after.',
  };
}

function formatCreatedCodesMessage(codes, parsed) {
  const common = [
    'Mode: balance code',
    parsed.label ? `Label: ${parsed.label}` : null,
    `Initial balance: ${parsed.questionCount}`,
    parsed.clientUsername ? `For: ${parsed.clientUsername}` : null,
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
  return `${quiz.id}. ${title} | course ${quiz.courseNumber || '-'} | devices ${quiz.deviceCount || 0}${formatQuizPublicStatus(quiz)}${isAiGeneratedQuiz(quiz) ? ' | AI' : ''}`;
}

function formatSiteDetails(quiz) {
  const devices = Array.isArray(quiz.devices) ? quiz.devices : [];
  const creatorLines = formatCreatorDetails(quiz.creatorSnapshot);
  const reports = listQuizReports(100).filter((report) => report.quizId === quiz.id);

  return [
    `Site ${quiz.id}`,
    `Title: ${quiz.title}`,
    `Course: ${quiz.courseNumber || '-'}`,
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

function formatSiteCountStats(stats) {
  if (!stats || Number(stats.quizCount || 0) === 0) {
    return [
      `Range: ${stats?.startQuizId || '-'}-${stats?.endQuizId || '-'}`,
      'Sites found: 0',
      'Total questions: 0',
    ].join('\n');
  }

  return [
    `Range: ${stats.startQuizId}-${stats.endQuizId}`,
    `Sites found: ${stats.quizCount}`,
    `Total questions: ${stats.totalQuestions}`,
    `Actual ids: ${stats.firstQuizId}-${stats.lastQuizId}`,
    `Average per site: ${Math.round(stats.totalQuestions / stats.quizCount)}`,
  ].join('\n');
}

function formatAccessCodeStatus(code, result) {
  const linkedQuiz = result.usedByQuizId ? getQuizById(result.usedByQuizId) : null;

  return [
    `Code: ${String(code || '').trim()}`,
    `Status: ${result.revokedAt ? 'disabled' : 'active'}`,
    `Type: ${result.siteType || '-'}${result.siteType ? ` (${result.siteType === '2' ? 'group' : 'single'})` : ''}`,
    `Remaining: ${result.remainingQuestionCount ?? 'unlimited'}`,
    `Consumed: ${result.consumedQuestionCount || 0}`,
    `Total credited: ${result.expectedQuestionCount ?? 'unlimited'}`,
    `TG: ${result.clientTgUsername || '-'}`,
    `Price: ${formatPrice(result.price)}`,
    `Used at: ${formatDateTime(result.usedAt)}`,
    `Site: ${linkedQuiz ? `${linkedQuiz.id} (${linkedQuiz.slug})` : (result.usedByQuizId || '-')}`,
  ].join('\n');
}

function formatHomepageNotice(notice, header = 'Homepage notice:') {
  return [
    header,
    `Updated: ${formatDateTime(notice?.updatedAt)}`,
    '',
    String(notice?.message || '').trim() || '-',
  ].join('\n');
}

function formatAiRuntimeStatus() {
  const settings = getAiRuntimeSettings();
  const usage = getAiUsageStats();

  return [
    'AI status:',
    `Enabled: ${settings.enabled ? 'yes' : 'no'}`,
    `Mode: ${settings.mode}`,
    `Require code: ${settings.requireCode ? 'yes' : 'no'}`,
    `Today requests: ${usage.usedToday}`,
    `Daily limit: ${settings.dailyLimit > 0 ? settings.dailyLimit : 'off'}`,
    `Remaining today: ${usage.remainingToday == null ? 'unlimited' : usage.remainingToday}`,
    `Reset: ${formatDateTime(usage.nextResetAt)}`,
  ].join('\n');
}

function formatAiLogsText(limit) {
  const logs = listAiRequestLogs(limit);
  if (!logs.length) {
    return 'No AI logs yet.\n';
  }

  return [
    `Latest AI logs: ${logs.length}`,
    '',
    ...logs.map((log) => [
      `${log.id}. ${log.status} | ${formatDateTime(log.createdAt)}`,
      `Browser ID: ${log.browserId || '-'}`,
      `Title: ${truncate(log.title || log.sourceFilename || '-', 80)}`,
      `Model: ${log.model || '-'}`,
    ].join('\n')),
  ].join('\n\n');
}

function formatAiNoVisitSites(limit) {
  const items = listQuizzesForAdmin()
    .filter((quiz) => isAiGeneratedQuiz(quiz) && Number(quiz.deviceCount || 0) === 0)
    .slice(0, limit);

  if (!items.length) {
    return 'No AI sites without visits.';
  }

  return [
    `AI sites without visits: ${items.length}`,
    '',
    ...items.map((quiz) => [
      `${quiz.id}. ${quiz.title || `Site ${quiz.id}`}`,
      `Created: ${formatDateTime(quiz.createdAt)}`,
      `Browser ID: ${quiz.creatorSnapshot?.browserId || '-'}`,
      `Slug: ${quiz.slug}`,
    ].join('\n')),
  ].join('\n\n');
}

function formatAiBans(limit) {
  const entries = listAiDeviceBans(limit);
  if (!entries.length) {
    return 'No AI device bans.';
  }

  return [
    `AI device bans: ${entries.length}`,
    '',
    ...entries.map((entry, index) => `${index + 1}. ${entry.browserId} | ${formatDateTime(entry.createdAt)} | ${entry.reason || 'no reason'}`),
  ].join('\n');
}

function formatAiBanEntry(entry, header) {
  if (!entry) {
    return `${header}\nBrowser ID: -`;
  }

  return [
    header,
    `Browser ID: ${entry.browserId}`,
    `Created: ${formatDateTime(entry.createdAt)}`,
    `Reason: ${entry.reason || '-'}`,
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

  if (filters.ai !== null && isAiGeneratedQuiz(quiz) !== Boolean(filters.ai)) {
    return false;
  }

  const deviceCount = Number(quiz.deviceCount || 0);
  if (filters.visited !== null) {
    const visited = deviceCount > 0;
    if (visited !== Boolean(filters.visited)) {
      return false;
    }
  }
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

function isAiGeneratedQuiz(quiz) {
  const raw = quiz?.rawModelJson || {};
  return String(raw.answerMode || '') === 'openai-double-check'
    || Boolean(raw.aiPrimaryModel)
    || Boolean(raw.aiCheckModel)
    || Boolean(raw.aiAnswerKeyText);
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
    filters.ai !== null ? `ai=${filters.ai ? 'yes' : 'no'}` : null,
    filters.visited !== null ? `visited=${filters.visited ? 'yes' : 'no'}` : null,
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
