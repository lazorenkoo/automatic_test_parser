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
.correction-field label{
  font-size:14px;
  font-weight:700;
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
.correction-actions{
  display:flex;
  flex-wrap:wrap;
  justify-content:flex-end;
  gap:10px;
  margin-top:14px;
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
const configuredOptionCount = Number.isInteger(Number(bootstrapData.configuredOptionCount))
  ? Math.max(0, Number(bootstrapData.configuredOptionCount))
  : 0;

const i18n = {
  eyebrow: 'PDMU quiz link',
  linkLabel: 'Link',
  countLabel: 'Questions',
  intro: 'You can shuffle the order of questions. Answer options will be shuffled automatically.',
  shuffle: 'Shuffle questions',
  start: 'Start',
  questionShort: 'Question',
  questionCounter: 'Question {current} of {total}',
  jumpLabel: 'Go to question',
  jumpButton: 'Go',
  finish: 'Finish now',
  finishConfirm: 'Finish the test now? The results will be shown immediately.',
  correctionOpen: 'Fix question',
  correctionTitle: 'Suggest a correction',
  correctionIntro: 'You can edit the current question and its answer options. The fix will be saved for review.',
  correctionQuestion: 'Question',
  correctionOption: 'Answer {number}',
  correctionCancel: 'Cancel',
  correctionSubmit: 'Confirm fix',
  correctionSuccess: 'The correction was saved.',
  correctionInvalid: 'Could not prepare this correction.',
  correctionUnavailable: 'This quiz cannot accept corrections right now.',
  correctionError: 'Could not save the correction. Please try again later.',
  next: 'Next',
  results: 'Results',
  restart: 'Restart',
  summary: 'Summary: {correct} / {answered} · {time}',
  correct: 'Correct',
  wrong: 'Wrong',
  minutes: 'min',
  seconds: 'sec',
  report: 'Report issue',
  reportPrompt: 'Describe what looks wrong in this test.',
  reportSuccess: 'The original file was sent to the admin for review.',
  reportError: 'Could not send the report. Please try again later.',
  reportUnavailable: 'This quiz cannot send a report right now.',
  warningTitle: 'Будь ласка, перевірте ще раз такі питання:',
};

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
};

const els = {
  pageTitle: document.getElementById('pageTitle'),
  quizTitle: document.getElementById('quizTitle'),
  questionCounter: document.getElementById('questionCounter'),
  correctionDot: document.getElementById('correctionDot'),
  start: document.getElementById('start'),
  quiz: document.getElementById('quiz'),
  results: document.getElementById('results'),
  qText: document.getElementById('qText'),
  options: document.getElementById('options'),
  next: document.getElementById('next'),
  finish: document.getElementById('finish'),
  correctionOpenBtn: document.getElementById('correctionOpenBtn'),
  correctionPanel: document.getElementById('correctionPanel'),
  correctionTitle: document.getElementById('correctionTitle'),
  correctionIntro: document.getElementById('correctionIntro'),
  correctionQuestionLabel: document.getElementById('correctionQuestionLabel'),
  correctionQuestionInput: document.getElementById('correctionQuestionInput'),
  correctionOptions: document.getElementById('correctionOptions'),
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
  document.documentElement.lang = 'en';
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
  if (els.correctionTitle) {
    els.correctionTitle.textContent = t('correctionTitle');
  }
  if (els.correctionIntro) {
    els.correctionIntro.textContent = t('correctionIntro');
  }
  if (els.correctionQuestionLabel) {
    els.correctionQuestionLabel.textContent = t('correctionQuestion');
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
  node.classList.remove('hidden');
}

function hide(node) {
  node.classList.add('hidden');
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
  return Math.max(currentCount, state.configuredOptionCount || 0);
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

  hide(els.start);
  hide(els.results);
  show(els.quiz);
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

function nextQuestion() {
  if (state.cur < state.order.length - 1) {
    state.cur += 1;
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
    const field = document.createElement('div');
    field.className = 'correction-field';

    const label = document.createElement('label');
    label.textContent = t('correctionOption', { number: visibleOptionIndex + 1 });
    label.setAttribute('for', 'correctionOption' + visibleOptionIndex);

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'correctionOption' + visibleOptionIndex;
    input.className = 'correction-input';
    input.value = Number.isInteger(sourceOptionIndex) ? (question.options[sourceOptionIndex] || '') : '';
    input.dataset.sourceOptionIndex = Number.isInteger(sourceOptionIndex) ? String(sourceOptionIndex) : '';
    input.dataset.visibleOptionIndex = String(visibleOptionIndex);

    field.appendChild(label);
    field.appendChild(input);
    els.correctionOptions.appendChild(field);
  }
}

function buildCorrectionPayload() {
  const { visibleIndex, sourceQuestionIndex, question, optionOrder } = getCurrentQuestionContext();
  if (!question || !Array.isArray(question.options) || !optionOrder.length) {
    return null;
  }

  const editedQuestionText = String(els.correctionQuestionInput?.value || '').trim();
  const optionInputs = [...(els.correctionOptions?.querySelectorAll('input[data-source-option-index]') || [])];
  const editableOptionCount = getEditableOptionCount(question);
  if (!editedQuestionText || optionInputs.length !== editableOptionCount) {
    return null;
  }

  const editedOptionsVisibleOrder = optionInputs.map((input) => String(input.value || '').trim());
  if (editedOptionsVisibleOrder.some((value) => !value)) {
    return null;
  }

  const editedOptionsSourceOrder = Array(question.options.length).fill('');
  let hasFullSourceOrder = true;
  optionInputs.forEach((input, visibleOptionIndex) => {
    const sourceOptionIndex = Number(input.dataset.sourceOptionIndex);
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
    shuffledOptionOrder: optionOrder.map((sourceIndex) => sourceIndex + 1),
    originalQuestionText: question.q,
    editedQuestionText,
    originalOptionsSourceOrder: [...question.options],
    editedOptionsSourceOrder: hasFullSourceOrder && !editedOptionsSourceOrder.some((value) => !value)
      ? editedOptionsSourceOrder
      : null,
    originalOptionsVisibleOrder: Array.from({ length: editableOptionCount }, (_, visibleOptionIndex) => {
      const sourceOptionIndex = optionOrder[visibleOptionIndex];
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
  const currentOrder = Array.isArray(state.optsOrder[sourceQuestionIndex]) ? [...state.optsOrder[sourceQuestionIndex]] : [];

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

    if (!response.ok) {
      throw new Error('Correction failed');
    }

    const result = await response.json();
    if (!result?.question) {
      throw new Error('Correction response invalid');
    }

    state.questions[sourceQuestionIndex] = result.question;
    const nextOptionCount = Array.isArray(result.question.options) ? result.question.options.length : 0;
    state.configuredOptionCount = Math.max(state.configuredOptionCount || 0, nextOptionCount);
    const nextOrder = currentOrder.filter((index) => Number.isInteger(index) && index >= 0 && index < nextOptionCount);
    for (let optionIndex = 0; optionIndex < nextOptionCount; optionIndex += 1) {
      if (!nextOrder.includes(optionIndex)) {
        nextOrder.push(optionIndex);
      }
    }
    state.optsOrder[sourceQuestionIndex] = nextOrder;

    closeCorrectionPanel();
    renderQuestion();
    showToast(t('correctionSuccess'));
  } catch (_error) {
    showToast(t('correctionError'));
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

function showResults() {
  hide(els.quiz);
  show(els.results);
  els.list.innerHTML = '';

  const answered = state.order.filter((questionIndex) => state.chosenAt[questionIndex] !== null);
  let correct = 0;

  answered.forEach((questionIndex) => {
    const question = state.questions[questionIndex];
    const optionOrder = state.optsOrder[questionIndex];
    const chosenRenderedIndex = state.chosenAt[questionIndex];
    const correctRenderedIndex = optionOrder.findIndex((index) => index === question.correctIndex);
    if (chosenRenderedIndex === correctRenderedIndex) {
      correct += 1;
    }

    const block = document.createElement('div');
    block.className = 'result-item';
    block.innerHTML =
      '<div class="small">' +
      (chosenRenderedIndex === correctRenderedIndex ? t('correct') : t('wrong')) +
      '</div><div style="font-weight:700;margin:6px 0 10px">' +
      question.q +
      '</div>';

    const group = document.createElement('div');
    group.className = 'options';

    optionOrder.forEach((sourceOptionIndex, renderedOptionIndex) => {
      const option = document.createElement('div');
      option.className = 'option disabled';
      if (renderedOptionIndex === chosenRenderedIndex) {
        option.classList.add(chosenRenderedIndex === correctRenderedIndex ? 'correct' : 'wrong');
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

  els.sum.textContent = t('summary', {
    correct,
    answered: answered.length,
    time: msToClock(Date.now() - (state.startedAt || Date.now())),
  });
}

function resetQuiz() {
  state.correctionOpen = false;
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

  try {
    const response = await fetch(reportUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        note,
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

  applyLanguage();

  els.startBtn?.addEventListener('click', startQuiz);
  els.next?.addEventListener('click', nextQuestion);
  els.finish?.addEventListener('click', confirmFinishQuiz);
  els.correctionOpenBtn?.addEventListener('click', openCorrectionPanel);
  els.correctionCancelBtn?.addEventListener('click', closeCorrectionPanel);
  els.correctionSubmitBtn?.addEventListener('click', submitCorrection);
  els.jumpBtn?.addEventListener('click', () => goToQuestion(els.jumpInput?.value));
  els.jumpInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      goToQuestion(els.jumpInput?.value);
    }
  });
  els.restartBtn?.addEventListener('click', resetQuiz);
  els.reportBtn?.addEventListener('click', reportBrokenQuiz);
});
`.trim();

export function renderHostedQuizHtml(quiz, options = {}) {
  const quizUrl = typeof options === 'string' ? options : options.quizUrl || null;
  const reportUrl = typeof options === 'object' && options ? options.reportUrl || '' : '';
  const correctionUrl = typeof options === 'object' && options ? options.correctionUrl || '' : '';
  const title = htmlEscape(quiz.title);
  const displayUrl = htmlEscape(quizUrl || quiz.slug);
  const bootstrap = safeJsonForScript({
    slug: quiz.slug,
    quizUrl: quizUrl || '',
    reportUrl,
    correctionUrl,
    title: quiz.title,
    configuredOptionCount: Number.isInteger(Number(quiz.rawModelJson?.optionCount))
      ? Number(quiz.rawModelJson.optionCount)
      : Math.max(0, ...quiz.questions.map((question) => Array.isArray(question?.options) ? question.options.length : 0)),
    questions: quiz.questions,
    aiDisagreements: Array.isArray(quiz.rawModelJson?.aiDisagreements) ? quiz.rawModelJson.aiDisagreements : [],
    aiSuspiciousQuestions: Array.isArray(quiz.rawModelJson?.aiSuspiciousQuestions) ? quiz.rawModelJson.aiSuspiciousQuestions : [],
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${quizCss}</style>
</head>
<body>
  <div class="shell">
    <button id="reportBtn" class="btn secondary report-fab" type="button">Report issue</button>
    <div id="reportToast" class="toast hidden" role="status" aria-live="polite"></div>

    <section class="hero">
      <span id="eyebrow" class="eyebrow">PDMU quiz link</span>
      <h1 id="pageTitle">${title}</h1>
      <div class="meta">
        <div class="meta-chip"><span id="linkLabel">Link</span>${displayUrl}</div>
        <div class="meta-chip"><span id="countLabel">Questions</span><strong id="quizLength">${quiz.questions.length}</strong></div>
      </div>
      <div id="warningBox" class="warning-panel hidden"></div>
    </section>

    <section id="start" class="card">
      <h2 id="quizTitle" class="title">${title}</h2>
      <p id="introText" class="lead">You can shuffle the order of questions. Answer options will be shuffled automatically.</p>
      <div class="controls" style="justify-content:flex-start">
        <label class="small" style="display:flex;align-items:center;gap:10px;font-size:14px">
          <input type="checkbox" id="shuffle" />
          <span id="shuffleLabel">Shuffle questions</span>
        </label>
      </div>
      <div class="controls">
        <div></div>
        <button class="btn primary" id="startBtn" type="button">Start</button>
      </div>
    </section>

    <section id="quiz" class="card hidden">
      <div class="question-meta">
        <div class="small" id="questionCounter">Question</div>
        <span id="correctionDot" class="correction-dot hidden" title="Question corrected by a user"></span>
      </div>
      <div class="jump-nav">
        <label for="jumpInput" id="jumpLabel">Go to question</label>
        <input id="jumpInput" class="jump-input" type="number" min="1" step="1" inputmode="numeric" />
        <button id="jumpBtn" class="btn secondary" type="button">Go</button>
      </div>
      <p id="qText" class="question"></p>
      <div id="options" class="options"></div>
      <div class="controls">
        <button id="correctionOpenBtn" class="btn secondary" type="button">Fix question</button>
        <button id="finish" class="btn ghost" type="button">Finish now</button>
        <button id="next" class="btn secondary" type="button">Next</button>
      </div>
      <div id="correctionPanel" class="correction-panel hidden">
        <h3 id="correctionTitle">Suggest a correction</h3>
        <p id="correctionIntro">You can edit the current question and its answer options. The fix will be saved for review.</p>
        <div class="correction-fields">
          <div class="correction-field">
            <label for="correctionQuestionInput" id="correctionQuestionLabel">Question</label>
            <textarea id="correctionQuestionInput" class="correction-textarea"></textarea>
          </div>
          <div id="correctionOptions" class="correction-fields"></div>
        </div>
        <div class="correction-actions">
          <button id="correctionCancelBtn" class="btn ghost" type="button">Cancel</button>
          <button id="correctionSubmitBtn" class="btn primary" type="button">Confirm fix</button>
        </div>
      </div>
    </section>

    <section id="results" class="card hidden">
      <h2 id="resultsTitle" class="title">Results</h2>
      <div id="sum" class="summary"></div>
      <div id="resultsList" class="results-list"></div>
      <div class="controls">
        <div></div>
        <button id="restartBtn" class="btn primary" type="button">Restart</button>
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
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(quiz.title)}</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div class="shell">
    <section class="hero">
      <span id="eyebrow" class="eyebrow">PDMU export</span>
      <h1 id="pageTitle">${htmlEscape(quiz.title)}</h1>
      <div class="meta">
        <div class="meta-chip"><span id="linkLabel">Link</span>${htmlEscape(folder)}</div>
        <div class="meta-chip"><span id="countLabel">Questions</span><strong id="quizLength">${quiz.questions.length}</strong></div>
      </div>
    </section>

    <section id="start" class="card">
      <h2 id="quizTitle" class="title">${htmlEscape(quiz.title)}</h2>
      <p id="introText" class="lead">You can shuffle the order of questions. Answer options will be shuffled automatically.</p>
      <div class="controls" style="justify-content:flex-start">
        <label class="small" style="display:flex;align-items:center;gap:10px;font-size:14px">
          <input type="checkbox" id="shuffle" />
          <span id="shuffleLabel">Shuffle questions</span>
        </label>
      </div>
      <div class="controls">
        <div></div>
        <button class="btn primary" id="startBtn" type="button">Start</button>
      </div>
    </section>

    <section id="quiz" class="card hidden">
      <div class="question-meta">
        <div class="small" id="questionCounter">Question</div>
        <span id="correctionDot" class="correction-dot hidden" title="Question corrected by a user"></span>
      </div>
      <div class="jump-nav">
        <label for="jumpInput" id="jumpLabel">Go to question</label>
        <input id="jumpInput" class="jump-input" type="number" min="1" step="1" inputmode="numeric" />
        <button id="jumpBtn" class="btn secondary" type="button">Go</button>
      </div>
      <p id="qText" class="question"></p>
      <div id="options" class="options"></div>
      <div class="controls">
        <button id="correctionOpenBtn" class="btn secondary" type="button">Fix question</button>
        <button id="finish" class="btn ghost" type="button">Finish now</button>
        <button id="next" class="btn secondary" type="button">Next</button>
      </div>
      <div id="correctionPanel" class="correction-panel hidden">
        <h3 id="correctionTitle">Suggest a correction</h3>
        <p id="correctionIntro">You can edit the current question and its answer options. The fix will be saved for review.</p>
        <div class="correction-fields">
          <div class="correction-field">
            <label for="correctionQuestionInput" id="correctionQuestionLabel">Question</label>
            <textarea id="correctionQuestionInput" class="correction-textarea"></textarea>
          </div>
          <div id="correctionOptions" class="correction-fields"></div>
        </div>
        <div class="correction-actions">
          <button id="correctionCancelBtn" class="btn ghost" type="button">Cancel</button>
          <button id="correctionSubmitBtn" class="btn primary" type="button">Confirm fix</button>
        </div>
      </div>
    </section>

    <section id="results" class="card hidden">
      <h2 id="resultsTitle" class="title">Results</h2>
      <div id="sum" class="summary"></div>
      <div id="resultsList" class="results-list"></div>
      <div class="controls">
        <div></div>
        <button id="restartBtn" class="btn primary" type="button">Restart</button>
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
