import { htmlEscape, safeJsonForScript, sanitizeFolderName } from './utils.js';

export const quizCss = `
:root{
  --bg:#f2eee6;
  --card:#ffffff;
  --ink:#1f2937;
  --muted:#6b7280;
  --accent:#bb4d00;
  --accent-soft:#fff1e6;
  --accent-strong:#7c2d12;
  --ok:#e7f8ea;
  --ok-border:#8bd3a2;
  --bad:#fee9e7;
  --bad-border:#f6a79d;
  --line:#eadfcf;
}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{
  font-family:"Outfit","Segoe UI",sans-serif;
  color:var(--ink);
  background:
    radial-gradient(circle at top left, rgba(187,77,0,.18), transparent 30%),
    radial-gradient(circle at bottom right, rgba(15,118,110,.14), transparent 26%),
    linear-gradient(160deg, #f8f4ee 0%, #f3ede2 100%);
}
.shell{
  max-width:980px;
  margin:0 auto;
  padding:32px 18px 48px;
  padding-left:max(18px, env(safe-area-inset-left));
  padding-right:max(18px, env(safe-area-inset-right));
  padding-bottom:max(48px, env(safe-area-inset-bottom));
}
.hero{
  padding:28px;
  border:1px solid rgba(124,45,18,.12);
  border-radius:28px;
  background:rgba(255,253,248,.85);
  backdrop-filter:blur(10px);
  box-shadow:0 18px 70px rgba(31,41,55,.08);
  margin-bottom:18px;
}
.eyebrow{
  display:inline-flex;
  align-items:center;
  gap:8px;
  padding:8px 12px;
  border-radius:999px;
  background:var(--accent-soft);
  color:var(--accent-strong);
  font-size:13px;
  font-weight:700;
  letter-spacing:.04em;
  text-transform:uppercase;
}
h1{
  margin:18px 0 10px;
  font-size:clamp(30px, 5vw, 48px);
  line-height:1.02;
}
.lead{
  margin:0;
  color:var(--muted);
  font-size:16px;
}
.card{
  margin-top:18px;
  background:var(--card);
  border:1px solid var(--line);
  border-radius:24px;
  padding:24px;
  box-shadow:0 18px 48px rgba(31,41,55,.07);
}
.warning-panel{
  margin-top:16px;
  padding:14px 16px;
  border-radius:18px;
  border:1px solid #f2c28b;
  background:#fff5e8;
  color:#9a3412;
}
.warning-panel strong{
  display:block;
  margin-bottom:6px;
}
.hidden{display:none}
.meta{
  display:grid;
  grid-template-columns:1fr;
  gap:12px;
  margin:18px 0 10px;
  max-width:420px;
}
.meta-chip{
  border:1px solid var(--line);
  background:#fffaf3;
  border-radius:18px;
  padding:12px 14px;
  overflow-wrap:anywhere;
  word-break:break-word;
}
.meta-chip span{
  display:block;
  color:var(--muted);
  font-size:13px;
  margin-bottom:4px;
}
.title{
  margin:0 0 10px;
  font-size:28px;
}
.question{
  margin:0 0 18px;
  font-size:20px;
  line-height:1.45;
}
.options{
  display:grid;
  gap:12px;
}
.option{
  width:100%;
  border:1px solid var(--line);
  border-radius:18px;
  padding:16px 18px;
  background:#fffaf6;
  cursor:pointer;
  text-align:left;
  font:inherit;
  transition:transform .16s ease, border-color .16s ease, background .16s ease;
}
.option:hover{transform:translateY(-1px);border-color:#d8bfa9}
.option.correct{
  background:var(--ok);
  border-color:var(--ok-border);
}
.option.wrong{
  background:var(--bad);
  border-color:var(--bad-border);
}
.option.disabled{cursor:default}
.controls{
  display:flex;
  flex-wrap:wrap;
  justify-content:space-between;
  gap:12px;
  margin-top:18px;
}
.jump-nav{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:10px;
  margin:14px 0 18px;
}
.jump-nav label{
  color:var(--muted);
  font-size:14px;
}
.jump-input{
  width:92px;
  border:1px solid var(--line);
  border-radius:12px;
  padding:10px 12px;
  background:#fffaf6;
  color:var(--ink);
  font:inherit;
}
.jump-input:focus{
  outline:2px solid rgba(187,77,0,.18);
  border-color:#d8bfa9;
}
.btn{
  appearance:none;
  border:none;
  border-radius:14px;
  padding:12px 18px;
  font:inherit;
  font-weight:700;
  cursor:pointer;
  transition:transform .16s ease, opacity .16s ease;
}
.btn:hover{transform:translateY(-1px)}
.btn.primary{
  background:linear-gradient(135deg, #bb4d00, #d97706);
  color:#fff;
}
.btn.secondary{
  background:#f7efe4;
  color:var(--accent-strong);
}
.btn.ghost{
  background:transparent;
  color:var(--muted);
  text-decoration:underline;
}
.btn:disabled{opacity:.45;cursor:not-allowed;transform:none}
.results-list{
  display:grid;
  gap:14px;
  margin-top:14px;
}
.result-item{
  border:1px solid var(--line);
  border-radius:18px;
  padding:16px;
  background:#fffaf6;
}
.small{
  color:var(--muted);
  font-size:13px;
  text-transform:uppercase;
  letter-spacing:.04em;
}
.question-meta{
  display:flex;
  align-items:center;
  gap:8px;
}
.correction-dot{
  width:10px;
  height:10px;
  border-radius:999px;
  background:#facc15;
  border:1px solid #ca8a04;
  flex:0 0 auto;
}
.summary{
  font-size:18px;
  font-weight:700;
}
.results-toolbar{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  margin-top:14px;
}
.segmented{
  display:inline-flex;
  flex-wrap:wrap;
  gap:8px;
}
.segmented .btn{
  padding:10px 14px;
}
.segmented .btn.active{
  background:linear-gradient(135deg, #bb4d00, #d97706);
  color:#fff;
}
.results-empty{
  margin-top:14px;
  padding:14px 16px;
  border:1px solid var(--line);
  border-radius:18px;
  background:#fffaf6;
  color:var(--muted);
}
.report-fab{
  position:fixed;
  right:18px;
  top:50%;
  transform:translateY(-50%);
  z-index:20;
}
.toast{
  position:fixed;
  right:18px;
  bottom:18px;
  max-width:min(360px, calc(100vw - 32px));
  padding:12px 14px;
  border-radius:16px;
  border:1px solid var(--line);
  background:rgba(255,253,248,.96);
  box-shadow:0 18px 40px rgba(31,41,55,.12);
  font-size:14px;
  line-height:1.45;
  z-index:30;
}
.correction-panel{
  margin-top:18px;
  padding:18px;
  border:1px solid var(--line);
  border-radius:20px;
  background:#fffaf3;
}
.correction-panel h3{
  margin:0 0 8px;
  font-size:20px;
}
.correction-panel p{
  margin:0 0 14px;
  color:var(--muted);
  font-size:14px;
  line-height:1.45;
}
.correction-fields{
  display:grid;
  gap:12px;
}
.correction-field{
  display:grid;
  gap:8px;
}
.correction-option-row{
  display:grid;
  grid-template-columns:minmax(0, 1fr) auto;
  gap:10px;
  align-items:end;
}
.correction-field label{
  font-size:14px;
  font-weight:700;
}
.correction-field.correct-answer label{
  color:#166534;
}
.correction-input,
.correction-textarea{
  width:100%;
  border:1px solid var(--line);
  border-radius:14px;
  padding:12px 14px;
  background:#fff;
  color:var(--ink);
  font:inherit;
}
.correction-textarea{
  min-height:110px;
  resize:vertical;
  line-height:1.45;
}
.correction-input:focus,
.correction-textarea:focus{
  outline:2px solid rgba(187,77,0,.18);
  border-color:#d8bfa9;
}
.correction-field.correct-answer .correction-input{
  background:#e7f8ea;
  border-color:#8bd3a2;
}
.correction-option-controls{
  display:flex;
  justify-content:flex-start;
  margin-top:12px;
}
.correction-remove-btn{
  min-width:96px;
}
.correction-actions{
  display:flex;
  flex-wrap:wrap;
  justify-content:flex-end;
  gap:10px;
  margin-top:14px;
}
.timer-panel{
  margin-top:18px;
  padding:16px;
  border:1px solid var(--line);
  border-radius:20px;
  background:#fffaf3;
}
.timer-grid{
  display:grid;
  gap:12px;
}
.timer-inline{
  display:grid;
  grid-template-columns:repeat(2, minmax(0, 1fr));
  gap:12px;
}
.timer-badge{
  display:inline-flex;
  align-items:center;
  gap:8px;
  margin:0 0 12px;
  padding:10px 12px;
  border-radius:999px;
  border:1px solid var(--line);
  background:#fffaf3;
  font-weight:700;
}
.timer-badge.danger{
  border-color:#f2c28b;
  background:#fff5e8;
  color:#9a3412;
}
.explanation-panel{
  margin-top:14px;
  padding:14px 16px;
  border:1px solid var(--line);
  border-radius:18px;
  background:#fffaf3;
  line-height:1.5;
}
.explanation-panel.loading{
  color:var(--muted);
}
.explanation-panel.error{
  border-color:#f2c28b;
  background:#fff5e8;
  color:#9a3412;
}
@media (hover:none){
  .option:hover,
  .btn:hover{transform:none}
}
@media (max-width:640px){
  .shell{
    padding:16px 12px 24px;
    padding-left:max(12px, env(safe-area-inset-left));
    padding-right:max(12px, env(safe-area-inset-right));
    padding-bottom:max(24px, env(safe-area-inset-bottom));
  }
  .hero,.card{
    padding:16px;
    border-radius:20px;
  }
  .eyebrow{
    font-size:12px;
    padding:7px 10px;
  }
  h1{
    margin:14px 0 8px;
    font-size:clamp(24px, 8vw, 34px);
    line-height:1.05;
  }
  .meta{
    gap:10px;
    margin-top:14px;
    max-width:none;
  }
  .meta-chip{
    padding:11px 12px;
    border-radius:14px;
  }
  .title{
    font-size:22px;
  }
  .small{
    font-size:12px;
  }
  .question{
    font-size:17px;
    line-height:1.5;
  }
  .option{
    padding:14px 14px;
    border-radius:14px;
    font-size:15px;
    line-height:1.45;
  }
  .controls{
    flex-direction:column-reverse;
    align-items:stretch;
  }
  .jump-nav{
    align-items:stretch;
  }
  .jump-input{
    width:100%;
  }
  .btn{
    width:100%;
    padding:14px 16px;
    border-radius:14px;
    text-align:center;
  }
  .summary{
    font-size:16px;
    line-height:1.4;
  }
  .result-item{
    padding:14px;
    border-radius:14px;
  }
  .report-fab{
    right:12px;
    top:auto;
    bottom:12px;
    transform:none;
  }
  .toast{
    right:12px;
    bottom:72px;
  }
  .correction-panel{
    padding:14px;
    border-radius:16px;
  }
  .timer-inline{
    grid-template-columns:1fr;
  }
  .correction-actions{
    flex-direction:column-reverse;
    align-items:stretch;
  }
}
@media (max-width:400px){
  .shell{
    padding:10px 8px 18px;
    padding-left:max(8px, env(safe-area-inset-left));
    padding-right:max(8px, env(safe-area-inset-right));
  }
  .hero,.card{
    padding:14px;
    border-radius:16px;
  }
  .question{
    font-size:16px;
  }
  .option{
    padding:13px 12px;
    font-size:14px;
  }
}
`.trim();

export const quizAppJs = `
'use strict';

const bootstrapData = typeof window !== 'undefined' && window.QUIZ_BOOTSTRAP
  ? window.QUIZ_BOOTSTRAP
  : {};

const bootstrapQuestions = Array.isArray(bootstrapData.questions)
  ? bootstrapData.questions
  : (typeof QUESTIONS !== 'undefined' ? QUESTIONS : []);
const aiDisagreements = Array.isArray(bootstrapData.aiDisagreements)
  ? bootstrapData.aiDisagreements
  : [];
const aiSuspiciousQuestions = Array.isArray(bootstrapData.aiSuspiciousQuestions)
  ? bootstrapData.aiSuspiciousQuestions
  : [];
const titleText = bootstrapData.title || bootstrapData.slug || 'Quiz';
const reportUrl = bootstrapData.reportUrl || '';
const correctionUrl = bootstrapData.correctionUrl || '';
const explanationUrl = bootstrapData.explanationUrl || '';
const explanationsEnabled = Boolean(bootstrapData.explanationsEnabled && explanationUrl);
const configuredOptionCount = Number.isInteger(Number(bootstrapData.configuredOptionCount))
  ? Math.max(0, Number(bootstrapData.configuredOptionCount))
  : 0;

const i18n = {
  eyebrow: 'Посилання на тест ПДМУ',
  linkLabel: 'Посилання',
  countLabel: 'Питань',
  intro: 'Ви можете перемішати порядок питань. Варіанти відповідей також буде перемішано автоматично.',
  shuffle: 'Перемішати питання',
  start: 'Почати',
  questionShort: 'Питання',
  questionCounter: 'Питання {current} із {total}',
  jumpLabel: 'Перейти до питання',
  jumpButton: 'Перейти',
  finish: 'Завершити тест',
  finishConfirm: 'Завершити тест зараз? Результати буде показано одразу.',
  correctionOpen: 'Виправити питання',
  correctionTitle: 'Запропонувати виправлення',
  correctionIntro: 'Ви можете відредагувати поточне питання та його варіанти відповіді. Зміни буде збережено в тесті.',
  correctionQuestion: 'Питання',
  correctionOption: 'Відповідь {number}',
  correctionAddOption: 'Додати варіант',
  correctionRemoveOption: 'Видалити',
  correctionCancel: 'Скасувати',
  correctionSubmit: 'Підтвердити виправлення',
  correctionSuccess: 'Виправлення збережено.',
  correctionInvalid: 'Не вдалося підготувати це виправлення.',
  correctionUnavailable: 'Зараз цей тест не приймає виправлення.',
  correctionError: 'Не вдалося зберегти виправлення. Спробуйте ще раз пізніше.',
  next: 'Далі',
  results: 'Результати',
  restart: 'Почати знову',
  summary: 'Підсумок: {correct} / {answered} · {time}',
  resultsFilterAll: 'Усі відповіді',
  resultsFilterWrong: 'Лише помилки',
  resultsEmptyWrong: 'Усі відповіді правильні. Помилок немає.',
  correct: 'Правильно',
  wrong: 'Неправильно',
  minutes: 'хв',
  seconds: 'с',
  report: 'Повідомити про помилку',
  reportPrompt: 'Опишіть, що саме не так у цьому тесті.',
  reportRequired: 'Потрібно вказати причину репорту.',
  reportSuccess: 'Оригінальний файл надіслано адміністратору на перевірку.',
  reportError: 'Не вдалося надіслати повідомлення. Спробуйте ще раз пізніше.',
  reportUnavailable: 'Зараз цей тест не може надсилати повідомлення.',
  warningTitle: 'Будь ласка, перевірте ще раз такі питання:',
};

i18n.explain = '\u041F\u043E\u044F\u0441\u043D\u0435\u043D\u043D\u044F';
i18n.explainLoading = '\u0413\u043E\u0442\u0443\u044E \u043A\u043E\u0440\u043E\u0442\u043A\u0435 \u043F\u043E\u044F\u0441\u043D\u0435\u043D\u043D\u044F...';
i18n.explainUnavailable = '\u0417\u0430\u0440\u0430\u0437 \u043F\u043E\u044F\u0441\u043D\u0435\u043D\u043D\u044F \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0435.';
i18n.explainError = '\u041D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F \u043E\u0442\u0440\u0438\u043C\u0430\u0442\u0438 \u043F\u043E\u044F\u0441\u043D\u0435\u043D\u043D\u044F. \u0421\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0449\u0435 \u0440\u0430\u0437 \u043F\u0456\u0437\u043D\u0456\u0448\u0435.';
i18n.timerTitle = '\u0422\u0430\u0439\u043C\u0435\u0440';
i18n.timerMode = '\u0420\u0435\u0436\u0438\u043C \u0442\u0430\u0439\u043C\u0435\u0440\u0430';
i18n.timerOff = '\u0411\u0435\u0437 \u0442\u0430\u0439\u043C\u0435\u0440\u0430';
i18n.timerPerQuestion = '\u041D\u0430 1 \u043F\u0438\u0442\u0430\u043D\u043D\u044F';
i18n.timerWholeTest = '\u041D\u0430 \u0432\u0435\u0441\u044C \u0442\u0435\u0441\u0442';
i18n.timerSeconds = '\u0421\u0435\u043A\u0443\u043D\u0434 \u043D\u0430 \u043F\u0438\u0442\u0430\u043D\u043D\u044F';
i18n.timerMinutes = '\u0425\u0432\u0438\u043B\u0438\u043D';
i18n.timerWholeSeconds = '\u0421\u0435\u043A\u0443\u043D\u0434';
i18n.timerRemainingQuestion = '\u0417\u0430\u043B\u0438\u0448\u0438\u043B\u043E\u0441\u044C \u043D\u0430 \u043F\u0438\u0442\u0430\u043D\u043D\u044F: {time}';
i18n.timerRemainingTotal = '\u0417\u0430\u043B\u0438\u0448\u0438\u043B\u043E\u0441\u044C \u043D\u0430 \u0442\u0435\u0441\u0442: {time}';
i18n.timerExpiredQuestion = '\u0427\u0430\u0441 \u043D\u0430 \u0446\u0435 \u043F\u0438\u0442\u0430\u043D\u043D\u044F \u0432\u0438\u0439\u0448\u043E\u0432.';
i18n.timerExpiredTotal = '\u0427\u0430\u0441 \u043D\u0430 \u0442\u0435\u0441\u0442 \u0432\u0438\u0439\u0448\u043E\u0432.';

const state = {
  questions: bootstrapQuestions,
  order: [],
  optsOrder: [],
  chosenAt: [],
  cur: 0,
  startedAt: null,
  shuffleQuestions: false,
  correctionOpen: false,
  configuredOptionCount,
  resultsFilter: 'all',
  resultsSnapshot: null,
  explanationsByQuestion: {},
  timerMode: 'off',
  timerPerQuestionSeconds: 30,
  timerTotalSeconds: 20 * 60,
  timerIntervalId: null,
  questionDeadlineAt: null,
  totalDeadlineAt: null,
};

const els = {
  pageTitle: document.getElementById('pageTitle'),
  quizTitle: document.getElementById('quizTitle'),
  questionCounter: document.getElementById('questionCounter'),
  correctionDot: document.getElementById('correctionDot'),
  start: document.getElementById('start'),
  quiz: document.getElementById('quiz'),
  results: document.getElementById('results'),
  resultsFilters: document.getElementById('resultsFilters'),
  resultsFilterAllBtn: document.getElementById('resultsFilterAllBtn'),
  resultsFilterWrongBtn: document.getElementById('resultsFilterWrongBtn'),
  qText: document.getElementById('qText'),
  options: document.getElementById('options'),
  next: document.getElementById('next'),
  finish: document.getElementById('finish'),
  correctionOpenBtn: document.getElementById('correctionOpenBtn'),
  explainBtn: document.getElementById('explainBtn'),
  explanationPanel: document.getElementById('explanationPanel'),
  correctionPanel: document.getElementById('correctionPanel'),
  timerModeSelect: document.getElementById('timerModeSelect'),
  timerPerQuestionField: document.getElementById('timerPerQuestionField'),
  timerPerQuestionInput: document.getElementById('timerPerQuestionInput'),
  timerTotalField: document.getElementById('timerTotalField'),
  timerMinutesInput: document.getElementById('timerMinutesInput'),
  timerSecondsInput: document.getElementById('timerSecondsInput'),
  timerDisplay: document.getElementById('timerDisplay'),
  correctionTitle: document.getElementById('correctionTitle'),
  correctionIntro: document.getElementById('correctionIntro'),
  correctionQuestionLabel: document.getElementById('correctionQuestionLabel'),
  correctionQuestionInput: document.getElementById('correctionQuestionInput'),
  correctionOptions: document.getElementById('correctionOptions'),
  correctionAddOptionBtn: document.getElementById('correctionAddOptionBtn'),
  correctionCancelBtn: document.getElementById('correctionCancelBtn'),
  correctionSubmitBtn: document.getElementById('correctionSubmitBtn'),
  jumpInput: document.getElementById('jumpInput'),
  jumpBtn: document.getElementById('jumpBtn'),
  jumpLabel: document.getElementById('jumpLabel'),
  sum: document.getElementById('sum'),
  list: document.getElementById('resultsList'),
  shuffle: document.getElementById('shuffle'),
  startBtn: document.getElementById('startBtn'),
  restartBtn: document.getElementById('restartBtn'),
  quizLength: document.getElementById('quizLength'),
  eyebrow: document.getElementById('eyebrow'),
  linkLabel: document.getElementById('linkLabel'),
  introText: document.getElementById('introText'),
  shuffleLabel: document.getElementById('shuffleLabel'),
  resultsTitle: document.getElementById('resultsTitle'),
  resultsEmpty: document.getElementById('resultsEmpty'),
  countLabel: document.getElementById('countLabel'),
  reportBtn: document.getElementById('reportBtn'),
  reportToast: document.getElementById('reportToast'),
  warningBox: document.getElementById('warningBox'),
};

function t(key, params = {}) {
  const template = i18n[key] || key;
  return String(template).replace(/\\{(\\w+)\\}/g, (_, token) => String(params[token] ?? '{' + token + '}'));
}

function applyLanguage() {
  document.documentElement.lang = 'uk';
  document.title = titleText;

  if (els.eyebrow) {
    els.eyebrow.textContent = t('eyebrow');
  }
  if (els.linkLabel) {
    els.linkLabel.textContent = t('linkLabel');
  }
  if (els.countLabel) {
    els.countLabel.textContent = t('countLabel');
  }
  if (els.introText) {
    els.introText.textContent = t('intro');
  }
  if (els.shuffleLabel) {
    els.shuffleLabel.textContent = t('shuffle');
  }
  if (els.startBtn) {
    els.startBtn.textContent = t('start');
  }
  if (els.finish) {
    els.finish.textContent = t('finish');
  }
  if (els.correctionOpenBtn) {
    els.correctionOpenBtn.textContent = t('correctionOpen');
  }
  if (els.explainBtn) {
    els.explainBtn.textContent = t('explain');
  }
  if (els.correctionTitle) {
    els.correctionTitle.textContent = t('correctionTitle');
  }
  if (els.correctionIntro) {
    els.correctionIntro.textContent = t('correctionIntro');
  }
  if (els.correctionQuestionLabel) {
    els.correctionQuestionLabel.textContent = t('correctionQuestion');
  }
  if (els.correctionAddOptionBtn) {
    els.correctionAddOptionBtn.textContent = t('correctionAddOption');
  }
  if (els.correctionCancelBtn) {
    els.correctionCancelBtn.textContent = t('correctionCancel');
  }
  if (els.correctionSubmitBtn) {
    els.correctionSubmitBtn.textContent = t('correctionSubmit');
  }
  if (els.jumpLabel) {
    els.jumpLabel.textContent = t('jumpLabel');
  }
  if (els.jumpBtn) {
    els.jumpBtn.textContent = t('jumpButton');
  }
  if (els.next) {
    els.next.textContent = t('next');
  }
  if (els.resultsTitle) {
    els.resultsTitle.textContent = t('results');
  }
  if (els.resultsFilterAllBtn) {
    els.resultsFilterAllBtn.textContent = t('resultsFilterAll');
  }
  if (els.resultsFilterWrongBtn) {
    els.resultsFilterWrongBtn.textContent = t('resultsFilterWrong');
  }
  if (els.resultsEmpty && !els.resultsEmpty.classList.contains('hidden')) {
    els.resultsEmpty.textContent = t('resultsEmptyWrong');
  }
  if (els.restartBtn) {
    els.restartBtn.textContent = t('restart');
  }
  if (els.reportBtn) {
    els.reportBtn.textContent = t('report');
  }
  if (els.warningBox) {
    const warningNumbers = Array.from(new Set([
      ...aiDisagreements.map((item) => String(item.questionNumber || '?')),
      ...aiSuspiciousQuestions.map((item) => String(item.questionNumber || '?')),
    ]));

    if (warningNumbers.length) {
      els.warningBox.innerHTML =
        '<strong>' + t('warningTitle') + '</strong>' +
        warningNumbers.join(', ');
      els.warningBox.classList.remove('hidden');
    } else {
      els.warningBox.classList.add('hidden');
    }
  }

  if (els.questionCounter && !els.quiz.classList.contains('hidden')) {
    els.questionCounter.textContent = t('questionCounter', {
      current: state.cur + 1,
      total: state.questions.length,
    });
  } else if (els.questionCounter) {
    els.questionCounter.textContent = t('questionShort');
  }
}

function show(node) {
  if (!node) {
    return;
  }
  node.classList.remove('hidden');
}

function hide(node) {
  if (!node) {
    return;
  }
  node.classList.add('hidden');
}

function ensureExplanationUi() {
  if (els.explainBtn && els.explanationPanel) {
    return;
  }

  const quizSection = document.getElementById('quiz');
  const controls = quizSection?.querySelector('.controls');
  if (!quizSection || !controls) {
    return;
  }

  if (!els.explainBtn) {
    const button = document.createElement('button');
    button.id = 'explainBtn';
    button.type = 'button';
    button.className = 'btn secondary hidden';
    button.textContent = t('explain');
    controls.insertBefore(button, els.finish || controls.lastElementChild || null);
    els.explainBtn = button;
  }

  if (!els.explanationPanel) {
    const panel = document.createElement('div');
    panel.id = 'explanationPanel';
    panel.className = 'explanation-panel hidden';
    const anchor = els.correctionPanel || controls.nextElementSibling;
    if (anchor && anchor.parentNode === quizSection) {
      quizSection.insertBefore(panel, anchor);
    } else {
      quizSection.appendChild(panel);
    }
    els.explanationPanel = panel;
  }
}

function ensureTimerUi() {
  if (!els.timerModeSelect || !els.timerDisplay) {
    const startSection = document.getElementById('start');
    const quizSection = document.getElementById('quiz');
    const startControls = startSection?.querySelector('.controls');
    const jumpNav = quizSection?.querySelector('.jump-nav');

    if (startSection && startControls && !els.timerModeSelect) {
      const panel = document.createElement('div');
      panel.className = 'timer-panel';
      panel.innerHTML =
        '<div class="timer-grid">' +
        '<div class="small">' + t('timerTitle') + '</div>' +
        '<label class="field">' +
        '<span>' + t('timerMode') + '</span>' +
        '<select id="timerModeSelect">' +
        '<option value="off">' + t('timerOff') + '</option>' +
        '<option value="question">' + t('timerPerQuestion') + '</option>' +
        '<option value="total">' + t('timerWholeTest') + '</option>' +
        '</select>' +
        '</label>' +
        '<div id="timerPerQuestionField" class="timer-inline hidden">' +
        '<label class="field">' +
        '<span>' + t('timerSeconds') + '</span>' +
        '<input id="timerPerQuestionInput" type="number" min="5" step="1" value="30" />' +
        '</label>' +
        '</div>' +
        '<div id="timerTotalField" class="timer-inline hidden">' +
        '<label class="field">' +
        '<span>' + t('timerMinutes') + '</span>' +
        '<input id="timerMinutesInput" type="number" min="0" step="1" value="20" />' +
        '</label>' +
        '<label class="field">' +
        '<span>' + t('timerWholeSeconds') + '</span>' +
        '<input id="timerSecondsInput" type="number" min="0" max="59" step="1" value="0" />' +
        '</label>' +
        '</div>' +
        '</div>';
      startSection.insertBefore(panel, startControls);
      els.timerModeSelect = document.getElementById('timerModeSelect');
      els.timerPerQuestionField = document.getElementById('timerPerQuestionField');
      els.timerPerQuestionInput = document.getElementById('timerPerQuestionInput');
      els.timerTotalField = document.getElementById('timerTotalField');
      els.timerMinutesInput = document.getElementById('timerMinutesInput');
      els.timerSecondsInput = document.getElementById('timerSecondsInput');
    }

    if (quizSection && jumpNav && !els.timerDisplay) {
      const badge = document.createElement('div');
      badge.id = 'timerDisplay';
      badge.className = 'timer-badge hidden';
      quizSection.insertBefore(badge, jumpNav);
      els.timerDisplay = badge;
    }
  }

  els.timerModeSelect?.addEventListener('change', syncTimerConfigUi);
  els.timerPerQuestionInput?.addEventListener('input', syncTimerConfigUi);
  els.timerMinutesInput?.addEventListener('input', syncTimerConfigUi);
  els.timerSecondsInput?.addEventListener('input', syncTimerConfigUi);
  syncTimerConfigUi();
}

function syncTimerConfigUi() {
  const mode = String(els.timerModeSelect?.value || 'off');
  state.timerMode = mode === 'question' || mode === 'total' ? mode : 'off';

  const perQuestion = Math.max(5, Number(els.timerPerQuestionInput?.value || 30) || 30);
  const totalMinutes = Math.max(0, Number(els.timerMinutesInput?.value || 20) || 0);
  const totalSecondsPart = Math.max(0, Math.min(59, Number(els.timerSecondsInput?.value || 0) || 0));
  const totalSeconds = totalMinutes * 60 + totalSecondsPart;

  state.timerPerQuestionSeconds = perQuestion;
  state.timerTotalSeconds = Math.max(5, totalSeconds || 0);

  if (els.timerPerQuestionInput) {
    els.timerPerQuestionInput.value = String(perQuestion);
  }
  if (els.timerMinutesInput) {
    els.timerMinutesInput.value = String(totalMinutes);
  }
  if (els.timerSecondsInput) {
    els.timerSecondsInput.value = String(totalSecondsPart);
  }

  els.timerPerQuestionField?.classList.toggle('hidden', state.timerMode !== 'question');
  els.timerTotalField?.classList.toggle('hidden', state.timerMode !== 'total');
  renderTimerDisplay();
}

function clearTimerState() {
  if (state.timerIntervalId) {
    window.clearInterval(state.timerIntervalId);
  }
  state.timerIntervalId = null;
  state.questionDeadlineAt = null;
  state.totalDeadlineAt = null;
  renderTimerDisplay();
}

function startTimerFlow() {
  clearTimerState();
  if (state.timerMode === 'total') {
    state.totalDeadlineAt = Date.now() + state.timerTotalSeconds * 1000;
  }
  if (state.timerMode === 'question') {
    state.questionDeadlineAt = Date.now() + state.timerPerQuestionSeconds * 1000;
  }
  if (state.timerMode === 'off') {
    renderTimerDisplay();
    return;
  }

  state.timerIntervalId = window.setInterval(() => {
    tickTimer();
  }, 250);
  renderTimerDisplay();
}

function resetQuestionTimerIfNeeded() {
  if (state.timerMode === 'question') {
    state.questionDeadlineAt = Date.now() + state.timerPerQuestionSeconds * 1000;
  }
  renderTimerDisplay();
}

function tickTimer() {
  const now = Date.now();
  if (state.timerMode === 'total' && state.totalDeadlineAt && now >= state.totalDeadlineAt) {
    clearTimerState();
    showToast(t('timerExpiredTotal'));
    showResults();
    return;
  }
  if (state.timerMode === 'question' && state.questionDeadlineAt && now >= state.questionDeadlineAt) {
    handleQuestionTimerExpired();
    return;
  }
  renderTimerDisplay();
}

function handleQuestionTimerExpired() {
  const { sourceQuestionIndex } = getCurrentQuestionContext();
  if (state.chosenAt[sourceQuestionIndex] === null) {
    state.chosenAt[sourceQuestionIndex] = -1;
  }
  renderQuestion();
  showToast(t('timerExpiredQuestion'));
  if (state.cur < state.order.length - 1) {
    state.cur += 1;
    renderQuestion();
    return;
  }
  clearTimerState();
  showResults();
}

function renderTimerDisplay() {
  if (!els.timerDisplay) {
    return;
  }

  els.timerDisplay.classList.remove('danger');
  if (state.timerMode === 'off') {
    els.timerDisplay.textContent = '';
    hide(els.timerDisplay);
    return;
  }

  let remainingMs = 0;
  let label = '';
  if (state.timerMode === 'question' && state.questionDeadlineAt) {
    remainingMs = Math.max(0, state.questionDeadlineAt - Date.now());
    label = t('timerRemainingQuestion', { time: formatCountdown(remainingMs) });
  } else if (state.timerMode === 'total' && state.totalDeadlineAt) {
    remainingMs = Math.max(0, state.totalDeadlineAt - Date.now());
    label = t('timerRemainingTotal', { time: formatCountdown(remainingMs) });
  } else {
    hide(els.timerDisplay);
    return;
  }

  els.timerDisplay.textContent = label;
  if (remainingMs <= 10000) {
    els.timerDisplay.classList.add('danger');
  }
  show(els.timerDisplay);
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
}

function shuffleArray(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
}

function msToClock(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes + ' ' + t('minutes') + ' ' + seconds + ' ' + t('seconds');
}

function getCurrentQuestionContext() {
  const visibleIndex = state.cur;
  const sourceQuestionIndex = state.order[visibleIndex];
  const question = state.questions[sourceQuestionIndex];
  const optionOrder = state.optsOrder[sourceQuestionIndex] || [];
  return {
    visibleIndex,
    sourceQuestionIndex,
    question,
    optionOrder,
  };
}

function getEditableOptionCount(question) {
  const currentCount = Array.isArray(question?.options) ? question.options.length : 0;
  return currentCount || state.configuredOptionCount || 0;
}

function startQuiz() {
  const totalQuestions = state.questions.length;
  state.order = [...Array(totalQuestions).keys()];
  state.shuffleQuestions = Boolean(els.shuffle?.checked);

  if (state.shuffleQuestions) {
    state.order = shuffleArray(state.order);
  }

  state.optsOrder = Array.from({ length: totalQuestions }, (_, questionIndex) => {
    const optionIndexes = [...Array(state.questions[questionIndex].options.length).keys()];
    return shuffleArray(optionIndexes);
  });

  state.chosenAt = Array(totalQuestions).fill(null);
  state.cur = 0;
  state.startedAt = Date.now();
  state.correctionOpen = false;
  state.resultsFilter = 'all';
  state.resultsSnapshot = null;
  state.explanationsByQuestion = {};

  hide(els.start);
  hide(els.results);
  show(els.quiz);
  startTimerFlow();
  renderQuestion();
}

function renderQuestion() {
  const { visibleIndex, sourceQuestionIndex: questionIndex, question, optionOrder } = getCurrentQuestionContext();

  els.questionCounter.textContent = t('questionCounter', {
    current: visibleIndex + 1,
    total: state.questions.length,
  });
  els.qText.textContent = question.q;
  els.options.innerHTML = '';

  optionOrder.forEach((sourceOptionIndex, renderedOptionIndex) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option';
    button.textContent = question.options[sourceOptionIndex];
    button.addEventListener('click', () => selectOption(questionIndex, renderedOptionIndex));
    els.options.appendChild(button);
  });

  if (els.jumpInput) {
    els.jumpInput.min = '1';
    els.jumpInput.max = String(state.order.length);
    els.jumpInput.value = String(visibleIndex + 1);
  }

  if (state.chosenAt[questionIndex] !== null) {
    colorize(questionIndex, state.chosenAt[questionIndex]);
  }

  renderExplanationState(questionIndex);
  if (els.correctionDot) {
    els.correctionDot.classList.toggle('hidden', !question?.manuallyCorrected);
  }

  renderCorrectionPanel();
  els.next.disabled = visibleIndex >= state.order.length - 1;
}

function selectOption(questionIndex, renderedOptionIndex) {
  if (state.chosenAt[questionIndex] !== null) {
    return;
  }

  state.chosenAt[questionIndex] = renderedOptionIndex;
  colorize(questionIndex, renderedOptionIndex);
  renderExplanationState(questionIndex);
}

function colorize(questionIndex, chosenRenderedIndex) {
  const question = state.questions[questionIndex];
  const optionOrder = state.optsOrder[questionIndex];
  const correctRenderedIndex = optionOrder.findIndex((index) => index === question.correctIndex);
  const nodes = [...els.options.children];

  nodes.forEach((node, currentIndex) => {
    node.classList.remove('correct', 'wrong', 'disabled');
    if (currentIndex === chosenRenderedIndex) {
      node.classList.add(currentIndex === correctRenderedIndex ? 'correct' : 'wrong');
    }
    if (currentIndex !== chosenRenderedIndex && currentIndex === correctRenderedIndex) {
      node.classList.add('correct');
    }
    node.classList.add('disabled');
  });
}

function renderExplanationState(questionIndex) {
  if (els.explainBtn) {
    els.explainBtn.classList.toggle('hidden', !explanationsEnabled);
    els.explainBtn.disabled = state.chosenAt[questionIndex] === null;
  }

  if (!els.explanationPanel) {
    return;
  }

  const entry = state.explanationsByQuestion[questionIndex];
  const isAnswered = state.chosenAt[questionIndex] !== null;

  els.explanationPanel.classList.remove('loading', 'error');

  if (!isAnswered || !explanationsEnabled) {
    els.explanationPanel.textContent = '';
    hide(els.explanationPanel);
    return;
  }

  if (!entry) {
    els.explanationPanel.textContent = '';
    hide(els.explanationPanel);
    return;
  }

  if (entry.status === 'loading') {
    els.explanationPanel.textContent = t('explainLoading');
    els.explanationPanel.classList.add('loading');
    show(els.explanationPanel);
    return;
  }

  if (entry.status === 'error') {
    els.explanationPanel.textContent = entry.message || t('explainError');
    els.explanationPanel.classList.add('error');
    show(els.explanationPanel);
    return;
  }

  if (entry.status === 'ready' && entry.text) {
    els.explanationPanel.textContent = entry.text;
    show(els.explanationPanel);
    return;
  }

  els.explanationPanel.textContent = '';
  hide(els.explanationPanel);
}

async function requestExplanation() {
  const { sourceQuestionIndex: questionIndex, optionOrder } = getCurrentQuestionContext();
  if (!explanationsEnabled || !explanationUrl) {
    showToast(t('explainUnavailable'));
    return;
  }

  const chosenRenderedIndex = state.chosenAt[questionIndex];
  if (chosenRenderedIndex === null) {
    return;
  }

  const cached = state.explanationsByQuestion[questionIndex];
  if (cached?.status === 'ready') {
    renderExplanationState(questionIndex);
    return;
  }
  if (cached?.status === 'loading') {
    return;
  }

  const selectedSourceOptionIndex = optionOrder[chosenRenderedIndex];
  state.explanationsByQuestion[questionIndex] = {
    status: 'loading',
    text: '',
    message: '',
  };
  renderExplanationState(questionIndex);

  try {
    const response = await fetch(explanationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        questionNumber: questionIndex + 1,
        selectedOptionNumber: Number.isInteger(selectedSourceOptionIndex) ? selectedSourceOptionIndex + 1 : null,
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result?.error || t('explainError'));
    }

    state.explanationsByQuestion[questionIndex] = {
      status: 'ready',
      text: String(result?.explanation || '').trim(),
      message: '',
    };
  } catch (error) {
    state.explanationsByQuestion[questionIndex] = {
      status: 'error',
      text: '',
      message: error?.message || t('explainError'),
    };
  }

  const currentContext = getCurrentQuestionContext();
  renderExplanationState(currentContext.sourceQuestionIndex);
}

function nextQuestion() {
  if (state.cur < state.order.length - 1) {
    state.cur += 1;
    resetQuestionTimerIfNeeded();
    renderQuestion();
  }
}

function goToQuestion(rawValue) {
  const total = state.order.length;
  const numericValue = Number(rawValue);
  if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > total) {
    if (els.jumpInput) {
      els.jumpInput.value = String(state.cur + 1);
    }
    return;
  }

  state.cur = numericValue - 1;
  resetQuestionTimerIfNeeded();
  renderQuestion();
}

function openCorrectionPanel() {
  state.correctionOpen = true;
  renderCorrectionPanel();
}

function closeCorrectionPanel() {
  state.correctionOpen = false;
  renderCorrectionPanel();
}

function addCorrectionOption() {
  appendCorrectionOptionField({ value: '', sourceOptionIndex: null, isCorrectAnswer: false });
  const lastInput = els.correctionOptions?.querySelector('.correction-option-row:last-child input.correction-input');
  lastInput?.focus();
}

function createCorrectionOptionField({ visibleOptionIndex, value = '', sourceOptionIndex = null, isCorrectAnswer = false }) {
  const field = document.createElement('div');
  field.className = 'correction-field correction-option-row';
  if (isCorrectAnswer) {
    field.classList.add('correct-answer');
  }

  const inputWrap = document.createElement('div');
  inputWrap.className = 'correction-field';

  const label = document.createElement('label');
  label.textContent = t('correctionOption', { number: visibleOptionIndex + 1 });
  label.setAttribute('for', 'correctionOption' + visibleOptionIndex);

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'correctionOption' + visibleOptionIndex;
  input.className = 'correction-input';
  input.value = value;
  input.dataset.sourceOptionIndex = Number.isInteger(sourceOptionIndex) ? String(sourceOptionIndex) : '';
  input.dataset.visibleOptionIndex = String(visibleOptionIndex);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn ghost correction-remove-btn';
  removeBtn.textContent = t('correctionRemoveOption');
  removeBtn.addEventListener('click', () => {
    if (!els.correctionOptions || els.correctionOptions.children.length <= 2) {
      return;
    }
    field.remove();
    refreshCorrectionOptionFields();
  });

  inputWrap.appendChild(label);
  inputWrap.appendChild(input);
  field.appendChild(inputWrap);
  field.appendChild(removeBtn);
  return field;
}

function refreshCorrectionOptionFields() {
  const fields = [...(els.correctionOptions?.querySelectorAll('.correction-option-row') || [])];
  const disableRemoval = fields.length <= 2;

  fields.forEach((field, visibleOptionIndex) => {
    const label = field.querySelector('label');
    const input = field.querySelector('input.correction-input');
    const removeBtn = field.querySelector('.correction-remove-btn');

    if (label) {
      label.textContent = t('correctionOption', { number: visibleOptionIndex + 1 });
      label.setAttribute('for', 'correctionOption' + visibleOptionIndex);
    }

    if (input) {
      input.id = 'correctionOption' + visibleOptionIndex;
      input.dataset.visibleOptionIndex = String(visibleOptionIndex);
    }

    if (removeBtn) {
      removeBtn.textContent = t('correctionRemoveOption');
      removeBtn.disabled = disableRemoval;
    }
  });
}

function appendCorrectionOptionField({ value = '', sourceOptionIndex = null, isCorrectAnswer = false } = {}) {
  if (!els.correctionOptions) {
    return;
  }

  const visibleOptionIndex = els.correctionOptions.children.length;
  const field = createCorrectionOptionField({
    visibleOptionIndex,
    value,
    sourceOptionIndex,
    isCorrectAnswer,
  });
  els.correctionOptions.appendChild(field);
  refreshCorrectionOptionFields();
}

function renderCorrectionPanel() {
  if (!els.correctionPanel || !els.correctionQuestionInput || !els.correctionOptions) {
    return;
  }

  if (!state.correctionOpen) {
    hide(els.correctionPanel);
    return;
  }

  const { question, optionOrder } = getCurrentQuestionContext();
  if (!question) {
    hide(els.correctionPanel);
    return;
  }

  show(els.correctionPanel);
  els.correctionQuestionInput.value = question.q || '';
  els.correctionOptions.innerHTML = '';
  const editableOptionCount = getEditableOptionCount(question);

  for (let visibleOptionIndex = 0; visibleOptionIndex < editableOptionCount; visibleOptionIndex += 1) {
    const sourceOptionIndex = optionOrder[visibleOptionIndex];
    appendCorrectionOptionField({
      value: Number.isInteger(sourceOptionIndex) ? (question.options[sourceOptionIndex] || '') : '',
      sourceOptionIndex: Number.isInteger(sourceOptionIndex) ? sourceOptionIndex : null,
      isCorrectAnswer: sourceOptionIndex === question.correctIndex,
    });
  }
}

function readCorrectionSourceOptionIndex(input) {
  const rawValue = input?.dataset?.sourceOptionIndex;
  if (rawValue === '' || rawValue === null || rawValue === undefined) {
    return null;
  }

  const numericValue = Number(rawValue);
  return Number.isInteger(numericValue) && numericValue >= 0 ? numericValue : null;
}

function buildCorrectionPayload() {
  const { visibleIndex, sourceQuestionIndex, question } = getCurrentQuestionContext();
  if (!question || !Array.isArray(question.options)) {
    return null;
  }

  const editedQuestionText = String(els.correctionQuestionInput?.value || '').trim();
  const optionInputs = [...(els.correctionOptions?.querySelectorAll('input[data-source-option-index]') || [])];
  const editableOptionCount = optionInputs.length;
  if (!editedQuestionText || optionInputs.length !== editableOptionCount) {
    return null;
  }

  const editedOptionsVisibleOrder = optionInputs.map((input) => String(input.value || '').trim());
  if (editedOptionsVisibleOrder.length < 2 || editedOptionsVisibleOrder.some((value) => !value)) {
    return null;
  }

  const editedOptionsSourceOrder = Array(question.options.length).fill('');
  const visibleOptionSourceOrder = optionInputs.map((input) => {
    const sourceOptionIndex = readCorrectionSourceOptionIndex(input);
    return Number.isInteger(sourceOptionIndex) ? sourceOptionIndex + 1 : null;
  });
  let hasFullSourceOrder = true;
  optionInputs.forEach((input, visibleOptionIndex) => {
    const sourceOptionIndex = readCorrectionSourceOptionIndex(input);
    if (Number.isInteger(sourceOptionIndex) && sourceOptionIndex >= 0 && sourceOptionIndex < editedOptionsSourceOrder.length) {
      editedOptionsSourceOrder[sourceOptionIndex] = editedOptionsVisibleOrder[visibleOptionIndex];
      return;
    }
    hasFullSourceOrder = false;
  });

  return {
    visibleQuestionNumber: visibleIndex + 1,
    sourceQuestionNumber: sourceQuestionIndex + 1,
    configuredOptionCount: editableOptionCount,
    shuffleQuestions: Boolean(state.shuffleQuestions),
    shuffledOptionOrder: visibleOptionSourceOrder.filter((sourceIndex) => Number.isInteger(sourceIndex)),
    visibleOptionSourceOrder,
    originalQuestionText: question.q,
    editedQuestionText,
    originalOptionsSourceOrder: [...question.options],
    editedOptionsSourceOrder: hasFullSourceOrder && !editedOptionsSourceOrder.some((value) => !value)
      ? editedOptionsSourceOrder
      : null,
    originalOptionsVisibleOrder: optionInputs.map((input, visibleOptionIndex) => {
      const sourceOptionIndex = readCorrectionSourceOptionIndex(input);
      return Number.isInteger(sourceOptionIndex) ? (question.options[sourceOptionIndex] || '') : '';
    }),
    editedOptionsVisibleOrder,
  };
}

async function submitCorrection() {
  if (!correctionUrl) {
    showToast(t('correctionUnavailable'));
    return;
  }

  const correction = buildCorrectionPayload();
  if (!correction) {
    showToast(t('correctionInvalid'));
    return;
  }

  const payload = {
    correction,
  };

  const { sourceQuestionIndex } = getCurrentQuestionContext();

  if (els.correctionSubmitBtn) {
    els.correctionSubmitBtn.disabled = true;
  }

  try {
    const response = await fetch(correctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    let result = null;
    try {
      result = await response.json();
    } catch {
      result = null;
    }

    if (!response.ok) {
      throw new Error(result?.error || t('correctionError'));
    }

    if (!result?.question) {
      throw new Error('Correction response invalid');
    }

    state.questions[sourceQuestionIndex] = result.question;
    const nextOptionCount = Array.isArray(result.question.options) ? result.question.options.length : 0;
    state.configuredOptionCount = nextOptionCount;
    state.optsOrder[sourceQuestionIndex] = Array.from({ length: nextOptionCount }, (_, optionIndex) => optionIndex);

    closeCorrectionPanel();
    renderQuestion();
    showToast(t('correctionSuccess'));
  } catch (error) {
    showToast(error?.message || t('correctionError'));
  } finally {
    if (els.correctionSubmitBtn) {
      els.correctionSubmitBtn.disabled = false;
    }
  }
}

function confirmFinishQuiz() {
  if (!window.confirm(t('finishConfirm'))) {
    return;
  }

  showResults();
}

function buildResultsSnapshot() {
  const answered = state.order.filter((questionIndex) => state.chosenAt[questionIndex] !== null);
  const items = [];
  let correct = 0;

  answered.forEach((questionIndex) => {
    const question = state.questions[questionIndex];
    const optionOrder = state.optsOrder[questionIndex];
    const chosenRenderedIndex = state.chosenAt[questionIndex];
    const correctRenderedIndex = optionOrder.findIndex((index) => index === question.correctIndex);
    const isCorrect = chosenRenderedIndex === correctRenderedIndex;
    if (isCorrect) {
      correct += 1;
    }
    items.push({
      question,
      optionOrder,
      chosenRenderedIndex,
      correctRenderedIndex,
      isCorrect,
    });
  });

  return {
    answeredCount: answered.length,
    correctCount: correct,
    durationMs: Date.now() - (state.startedAt || Date.now()),
    items,
  };
}

function updateResultsFilterButtons() {
  els.resultsFilterAllBtn?.classList.toggle('active', state.resultsFilter === 'all');
  els.resultsFilterWrongBtn?.classList.toggle('active', state.resultsFilter === 'wrong');
}

function renderResultsList() {
  if (!els.list) {
    return;
  }

  const snapshot = state.resultsSnapshot;
  els.list.innerHTML = '';
  hide(els.resultsEmpty);

  if (!snapshot) {
    return;
  }

  const visibleItems = state.resultsFilter === 'wrong'
    ? snapshot.items.filter((item) => !item.isCorrect)
    : snapshot.items;

  if (!visibleItems.length) {
    if (els.resultsEmpty) {
      els.resultsEmpty.textContent = t('resultsEmptyWrong');
      show(els.resultsEmpty);
    }
    return;
  }

  visibleItems.forEach(({ question, optionOrder, chosenRenderedIndex, correctRenderedIndex, isCorrect }) => {
    const block = document.createElement('div');
    block.className = 'result-item';
    block.innerHTML =
      '<div class="small">' +
      (isCorrect ? t('correct') : t('wrong')) +
      '</div><div style="font-weight:700;margin:6px 0 10px">' +
      question.q +
      '</div>';

    const group = document.createElement('div');
    group.className = 'options';

    optionOrder.forEach((sourceOptionIndex, renderedOptionIndex) => {
      const option = document.createElement('div');
      option.className = 'option disabled';
      if (renderedOptionIndex === chosenRenderedIndex) {
        option.classList.add(isCorrect ? 'correct' : 'wrong');
      }
      if (renderedOptionIndex !== chosenRenderedIndex && renderedOptionIndex === correctRenderedIndex) {
        option.classList.add('correct');
      }
      option.textContent = question.options[sourceOptionIndex];
      group.appendChild(option);
    });

    block.appendChild(group);
    els.list.appendChild(block);
  });
}

function showResults() {
  clearTimerState();
  hide(els.quiz);
  show(els.results);
  state.resultsSnapshot = buildResultsSnapshot();
  state.resultsFilter = 'all';
  updateResultsFilterButtons();
  renderResultsList();

  const snapshot = state.resultsSnapshot;
  els.sum.textContent = t('summary', {
    correct: snapshot.correctCount,
    answered: snapshot.answeredCount,
    time: msToClock(snapshot.durationMs),
  });
}

function setResultsFilter(filter) {
  if (filter !== 'all' && filter !== 'wrong') {
    return;
  }

  state.resultsFilter = filter;
  updateResultsFilterButtons();
  renderResultsList();
}

function resetQuiz() {
  clearTimerState();
  state.correctionOpen = false;
  state.resultsFilter = 'all';
  state.resultsSnapshot = null;
  state.explanationsByQuestion = {};
  hide(els.quiz);
  hide(els.results);
  show(els.start);
  applyLanguage();
}

function showToast(message) {
  if (!els.reportToast) {
    return;
  }

  els.reportToast.textContent = String(message || '');
  els.reportToast.classList.remove('hidden');
  window.clearTimeout(showToast.timerId);
  showToast.timerId = window.setTimeout(() => {
    els.reportToast?.classList.add('hidden');
  }, 3500);
}

async function reportBrokenQuiz() {
  if (!reportUrl) {
    showToast(t('reportUnavailable'));
    return;
  }

  const note = window.prompt(t('reportPrompt'), '');
  if (note === null) {
    return;
  }

  const normalizedNote = String(note || '').trim();
  if (!normalizedNote) {
    showToast(t('reportRequired'));
    return;
  }

  try {
    const response = await fetch(reportUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        note: normalizedNote,
        pageUrl: window.location.href,
        currentQuestion: state.cur + 1,
      }),
    });

    if (!response.ok) {
      throw new Error('Report failed');
    }

    showToast(t('reportSuccess'));
  } catch (_error) {
    showToast(t('reportError'));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (els.pageTitle) {
    els.pageTitle.textContent = titleText;
  }
  if (els.quizTitle) {
    els.quizTitle.textContent = titleText;
  }
  if (els.quizLength) {
    els.quizLength.textContent = String(state.questions.length);
  }

  ensureTimerUi();
  ensureExplanationUi();
  applyLanguage();

  els.startBtn?.addEventListener('click', startQuiz);
  els.next?.addEventListener('click', nextQuestion);
  els.finish?.addEventListener('click', confirmFinishQuiz);
  els.correctionOpenBtn?.addEventListener('click', openCorrectionPanel);
  els.explainBtn?.addEventListener('click', requestExplanation);
  els.correctionAddOptionBtn?.addEventListener('click', addCorrectionOption);
  els.correctionCancelBtn?.addEventListener('click', closeCorrectionPanel);
  els.correctionSubmitBtn?.addEventListener('click', submitCorrection);
  els.jumpBtn?.addEventListener('click', () => goToQuestion(els.jumpInput?.value));
  els.jumpInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      goToQuestion(els.jumpInput?.value);
    }
  });
  els.resultsFilterAllBtn?.addEventListener('click', () => setResultsFilter('all'));
  els.resultsFilterWrongBtn?.addEventListener('click', () => setResultsFilter('wrong'));
  els.restartBtn?.addEventListener('click', resetQuiz);
  els.reportBtn?.addEventListener('click', reportBrokenQuiz);
});
`.trim();

export function renderHostedQuizHtml(quiz, options = {}) {
  const quizUrl = typeof options === 'string' ? options : options.quizUrl || null;
  const reportUrl = typeof options === 'object' && options ? options.reportUrl || '' : '';
  const correctionUrl = typeof options === 'object' && options ? options.correctionUrl || '' : '';
  const explanationUrl = typeof options === 'object' && options ? options.explanationUrl || '' : '';
  const explanationsEnabled = typeof options === 'object' && options ? Boolean(options.explanationsEnabled) : false;
  const title = htmlEscape(quiz.title);
  const displayUrl = htmlEscape(quizUrl || quiz.slug);
  const bootstrap = safeJsonForScript({
    slug: quiz.slug,
    quizUrl: quizUrl || '',
    reportUrl,
    correctionUrl,
    explanationUrl,
    explanationsEnabled,
    title: quiz.title,
    configuredOptionCount: Number.isInteger(Number(quiz.rawModelJson?.optionCount))
      ? Number(quiz.rawModelJson.optionCount)
      : Math.max(0, ...quiz.questions.map((question) => Array.isArray(question?.options) ? question.options.length : 0)),
    questions: quiz.questions,
    aiDisagreements: Array.isArray(quiz.rawModelJson?.aiDisagreements) ? quiz.rawModelJson.aiDisagreements : [],
    aiSuspiciousQuestions: Array.isArray(quiz.rawModelJson?.aiSuspiciousQuestions) ? quiz.rawModelJson.aiSuspiciousQuestions : [],
  });

  return `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${quizCss}</style>
</head>
<body>
  <div class="shell">
    <button id="reportBtn" class="btn secondary report-fab" type="button">Повідомити про помилку</button>
    <div id="reportToast" class="toast hidden" role="status" aria-live="polite"></div>

    <section class="hero">
      <span id="eyebrow" class="eyebrow">Посилання на тест ПДМУ</span>
      <h1 id="pageTitle">${title}</h1>
      <div class="meta">
        <div class="meta-chip"><span id="linkLabel">Посилання</span>${displayUrl}</div>
        <div class="meta-chip"><span id="countLabel">Питань</span><strong id="quizLength">${quiz.questions.length}</strong></div>
      </div>
      <div id="warningBox" class="warning-panel hidden"></div>
    </section>

    <section id="start" class="card">
      <h2 id="quizTitle" class="title">${title}</h2>
      <p id="introText" class="lead">Ви можете перемішати порядок питань. Варіанти відповідей також буде перемішано автоматично.</p>
      <div class="controls" style="justify-content:flex-start">
        <label class="small" style="display:flex;align-items:center;gap:10px;font-size:14px">
          <input type="checkbox" id="shuffle" />
          <span id="shuffleLabel">Перемішати питання</span>
        </label>
      </div>
      <div class="controls">
        <div></div>
        <button class="btn primary" id="startBtn" type="button">Почати</button>
      </div>
    </section>

    <section id="quiz" class="card hidden">
      <div class="question-meta">
        <div class="small" id="questionCounter">Питання</div>
        <span id="correctionDot" class="correction-dot hidden" title="Питання було виправлене користувачем"></span>
      </div>
      <div class="jump-nav">
        <label for="jumpInput" id="jumpLabel">Перейти до питання</label>
        <input id="jumpInput" class="jump-input" type="number" min="1" step="1" inputmode="numeric" />
        <button id="jumpBtn" class="btn secondary" type="button">Перейти</button>
      </div>
      <p id="qText" class="question"></p>
      <div id="options" class="options"></div>
      <div class="controls">
        <button id="correctionOpenBtn" class="btn secondary" type="button">Виправити питання</button>
        <button id="finish" class="btn ghost" type="button">Завершити тест</button>
        <button id="next" class="btn secondary" type="button">Далі</button>
      </div>
      <div id="correctionPanel" class="correction-panel hidden">
        <h3 id="correctionTitle">Запропонувати виправлення</h3>
        <p id="correctionIntro">Ви можете відредагувати поточне питання та його варіанти відповіді. Зміни буде збережено в тесті.</p>
        <div class="correction-fields">
          <div class="correction-field">
            <label for="correctionQuestionInput" id="correctionQuestionLabel">Питання</label>
            <textarea id="correctionQuestionInput" class="correction-textarea"></textarea>
          </div>
          <div id="correctionOptions" class="correction-fields"></div>
          <div class="correction-option-controls">
            <button id="correctionAddOptionBtn" class="btn secondary" type="button">Додати варіант</button>
          </div>
        </div>
        <div class="correction-actions">
          <button id="correctionCancelBtn" class="btn ghost" type="button">Скасувати</button>
          <button id="correctionSubmitBtn" class="btn primary" type="button">Підтвердити виправлення</button>
        </div>
      </div>
    </section>

    <section id="results" class="card hidden">
      <h2 id="resultsTitle" class="title">Результати</h2>
      <div id="sum" class="summary"></div>
      <div id="resultsFilters" class="results-toolbar">
        <div class="segmented">
          <button id="resultsFilterAllBtn" class="btn secondary active" type="button">Усі відповіді</button>
          <button id="resultsFilterWrongBtn" class="btn secondary" type="button">Лише помилки</button>
        </div>
      </div>
      <div id="resultsEmpty" class="results-empty hidden"></div>
      <div id="resultsList" class="results-list"></div>
      <div class="controls">
        <div></div>
        <button id="restartBtn" class="btn primary" type="button">Почати знову</button>
      </div>
    </section>
  </div>

  <script>window.QUIZ_BOOTSTRAP = ${bootstrap};</script>
  <script>${quizAppJs}</script>
</body>
</html>`;
}

export function buildZipBundle(quiz) {
  const folder = sanitizeFolderName(quiz.title || quiz.slug);

  const indexHtml = `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(quiz.title)}</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div class="shell">
    <section class="hero">
      <span id="eyebrow" class="eyebrow">Експорт тесту ПДМУ</span>
      <h1 id="pageTitle">${htmlEscape(quiz.title)}</h1>
      <div class="meta">
        <div class="meta-chip"><span id="linkLabel">Посилання</span>${htmlEscape(folder)}</div>
        <div class="meta-chip"><span id="countLabel">Питань</span><strong id="quizLength">${quiz.questions.length}</strong></div>
      </div>
    </section>

    <section id="start" class="card">
      <h2 id="quizTitle" class="title">${htmlEscape(quiz.title)}</h2>
      <p id="introText" class="lead">Ви можете перемішати порядок питань. Варіанти відповідей також буде перемішано автоматично.</p>
      <div class="controls" style="justify-content:flex-start">
        <label class="small" style="display:flex;align-items:center;gap:10px;font-size:14px">
          <input type="checkbox" id="shuffle" />
          <span id="shuffleLabel">Перемішати питання</span>
        </label>
      </div>
      <div class="controls">
        <div></div>
        <button class="btn primary" id="startBtn" type="button">Почати</button>
      </div>
    </section>

    <section id="quiz" class="card hidden">
      <div class="question-meta">
        <div class="small" id="questionCounter">Питання</div>
        <span id="correctionDot" class="correction-dot hidden" title="Питання було виправлене користувачем"></span>
      </div>
      <div class="jump-nav">
        <label for="jumpInput" id="jumpLabel">Перейти до питання</label>
        <input id="jumpInput" class="jump-input" type="number" min="1" step="1" inputmode="numeric" />
        <button id="jumpBtn" class="btn secondary" type="button">Перейти</button>
      </div>
      <p id="qText" class="question"></p>
      <div id="options" class="options"></div>
      <div class="controls">
        <button id="correctionOpenBtn" class="btn secondary" type="button">Виправити питання</button>
        <button id="finish" class="btn ghost" type="button">Завершити тест</button>
        <button id="next" class="btn secondary" type="button">Далі</button>
      </div>
      <div id="correctionPanel" class="correction-panel hidden">
        <h3 id="correctionTitle">Запропонувати виправлення</h3>
        <p id="correctionIntro">Ви можете відредагувати поточне питання та його варіанти відповіді. Зміни буде збережено в тесті.</p>
        <div class="correction-fields">
          <div class="correction-field">
            <label for="correctionQuestionInput" id="correctionQuestionLabel">Питання</label>
            <textarea id="correctionQuestionInput" class="correction-textarea"></textarea>
          </div>
          <div id="correctionOptions" class="correction-fields"></div>
          <div class="correction-option-controls">
            <button id="correctionAddOptionBtn" class="btn secondary" type="button">Додати варіант</button>
          </div>
        </div>
        <div class="correction-actions">
          <button id="correctionCancelBtn" class="btn ghost" type="button">Скасувати</button>
          <button id="correctionSubmitBtn" class="btn primary" type="button">Підтвердити виправлення</button>
        </div>
      </div>
    </section>

    <section id="results" class="card hidden">
      <h2 id="resultsTitle" class="title">Результати</h2>
      <div id="sum" class="summary"></div>
      <div id="resultsFilters" class="results-toolbar">
        <div class="segmented">
          <button id="resultsFilterAllBtn" class="btn secondary active" type="button">Усі відповіді</button>
          <button id="resultsFilterWrongBtn" class="btn secondary" type="button">Лише помилки</button>
        </div>
      </div>
      <div id="resultsEmpty" class="results-empty hidden"></div>
      <div id="resultsList" class="results-list"></div>
      <div class="controls">
        <div></div>
        <button id="restartBtn" class="btn primary" type="button">Почати знову</button>
      </div>
    </section>
  </div>

  <script src="questions.js"></script>
  <script src="app.js"></script>
</body>
</html>`;

  return {
    folder,
    files: [
      { name: `${folder}/index.html`, content: indexHtml },
      { name: `${folder}/style.css`, content: quizCss },
      { name: `${folder}/app.js`, content: quizAppJs },
      { name: `${folder}/questions.js`, content: `const QUESTIONS = ${JSON.stringify(quiz.questions, null, 2)};` },
    ],
  };
}
