import { htmlEscape, safeJsonForScript, sanitizeFolderName } from './utils.js';

export const quizCss = `
:root{
  --bg:#f2eee6;
  --panel:#fffdf8;
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
.summary{
  font-size:18px;
  font-weight:700;
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

const LANGUAGE_STORAGE_KEY = 'pdmu-ui-language';

const bootstrapData = typeof window !== 'undefined' && window.QUIZ_BOOTSTRAP
  ? window.QUIZ_BOOTSTRAP
  : {};

const bootstrapQuestions = Array.isArray(bootstrapData.questions) ? bootstrapData.questions : (typeof QUESTIONS !== 'undefined' ? QUESTIONS : []);
const titleText = bootstrapData.title || 'Medical Quiz';

const i18n = {
  ru: {
    eyebrow: 'PDMU quiz link',
    linkLabel: 'Ссылка',
    countLabel: 'Вопросов',
    intro: 'Можно перемешать порядок вопросов. Варианты ответов будут перемешаны автоматически.',
    shuffle: 'Перемешать вопросы',
    start: 'Начать',
    questionShort: 'Вопрос',
    questionCounter: 'Вопрос {current} из {total}',
    finish: 'Завершить сейчас',
    next: 'Следующий',
    results: 'Результаты',
    restart: 'Пройти еще раз',
    summary: 'Итог: {correct} / {answered} · {time}',
    correct: 'Правильно',
    wrong: 'Ошибка',
    time: 'Время',
  },
  uk: {
    eyebrow: 'PDMU quiz link',
    linkLabel: 'Посилання',
    countLabel: 'Питань',
    intro: 'Можна перемішати порядок питань. Варіанти відповідей будуть перемішані автоматично.',
    shuffle: 'Перемішати питання',
    start: 'Почати',
    questionShort: 'Питання',
    questionCounter: 'Питання {current} із {total}',
    finish: 'Завершити зараз',
    next: 'Наступне',
    results: 'Результати',
    restart: 'Пройти ще раз',
    summary: 'Підсумок: {correct} / {answered} · {time}',
    correct: 'Правильно',
    wrong: 'Помилка',
    time: 'Час',
  },
};

const state = {
  questions: bootstrapQuestions,
  order: [],
  optsOrder: [],
  chosenAt: [],
  cur: 0,
  startedAt: null,
  shuffleQuestions: false,
  language: resolveLanguage(),
};

const els = {
  pageTitle: document.getElementById('pageTitle'),
  quizTitle: document.getElementById('quizTitle'),
  questionCounter: document.getElementById('questionCounter'),
  start: document.getElementById('start'),
  quiz: document.getElementById('quiz'),
  results: document.getElementById('results'),
  qText: document.getElementById('qText'),
  options: document.getElementById('options'),
  next: document.getElementById('next'),
  finish: document.getElementById('finish'),
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
};

function t(key, params = {}) {
  const dict = i18n[state.language] || i18n.ru;
  const template = dict[key] || i18n.ru[key] || key;
  return String(template).replace(/\\{(\\w+)\\}/g, (_, token) => String(params[token] ?? '{' + token + '}'));
}

function resolveLanguage() {
  const url = new URL(window.location.href);
  const queryLanguage = url.searchParams.get('lang');
  if (queryLanguage === 'ru' || queryLanguage === 'uk') {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, queryLanguage);
    return queryLanguage;
  }

  const savedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (savedLanguage === 'ru' || savedLanguage === 'uk') {
    return savedLanguage;
  }

  return 'ru';
}

function applyLanguage() {
  document.documentElement.lang = state.language === 'uk' ? 'uk' : 'ru';
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
  if (els.next) {
    els.next.textContent = t('next');
  }
  if (els.resultsTitle) {
    els.resultsTitle.textContent = t('results');
  }
  if (els.restartBtn) {
    els.restartBtn.textContent = t('restart');
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
  return state.language === 'uk'
    ? minutes + ' хв ' + seconds + ' с'
    : minutes + 'м ' + seconds + 'с';
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

  hide(els.start);
  hide(els.results);
  show(els.quiz);
  renderQuestion();
}

function renderQuestion() {
  const visibleIndex = state.cur;
  const questionIndex = state.order[visibleIndex];
  const question = state.questions[questionIndex];
  const optionOrder = state.optsOrder[questionIndex];

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
    block.innerHTML = '<div class="small">' + (chosenRenderedIndex === correctRenderedIndex ? t('correct') : t('wrong')) + '</div><div style="font-weight:700;margin:6px 0 10px">' + question.q + '</div>';

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
  hide(els.quiz);
  hide(els.results);
  show(els.start);
  applyLanguage();
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
  els.finish?.addEventListener('click', showResults);
  els.restartBtn?.addEventListener('click', resetQuiz);
});
`.trim();

export function renderHostedQuizHtml(quiz) {
  const title = htmlEscape(quiz.title);
  const bootstrap = safeJsonForScript({
    slug: quiz.slug,
    title: quiz.title,
    questions: quiz.questions,
  });

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${quizCss}</style>
</head>
<body>
  <div class="shell">
    <section class="hero">
      <span id="eyebrow" class="eyebrow">PDMU quiz link</span>
      <h1 id="pageTitle">${title}</h1>
      <div class="meta">
        <div class="meta-chip"><span id="linkLabel">Ссылка</span>${htmlEscape(quiz.slug)}</div>
        <div class="meta-chip"><span id="countLabel">Вопросов</span><strong id="quizLength">${quiz.questions.length}</strong></div>
      </div>
    </section>

    <section id="start" class="card">
      <h2 id="quizTitle" class="title">${title}</h2>
      <p id="introText" class="lead">Можно перемешать порядок вопросов. Варианты ответов будут перемешаны автоматически.</p>
      <div class="controls" style="justify-content:flex-start">
        <label class="small" style="display:flex;align-items:center;gap:10px;font-size:14px">
          <input type="checkbox" id="shuffle" />
          <span id="shuffleLabel">Перемешать вопросы</span>
        </label>
      </div>
      <div class="controls">
        <div></div>
        <button class="btn primary" id="startBtn" type="button">Начать</button>
      </div>
    </section>

    <section id="quiz" class="card hidden">
      <div class="small" id="questionCounter">Вопрос</div>
      <p id="qText" class="question"></p>
      <div id="options" class="options"></div>
      <div class="controls">
        <button id="finish" class="btn ghost" type="button">Завершить сейчас</button>
        <button id="next" class="btn secondary" type="button">Следующий</button>
      </div>
    </section>

    <section id="results" class="card hidden">
      <h2 id="resultsTitle" class="title">Результаты</h2>
      <div id="sum" class="summary"></div>
      <div id="resultsList" class="results-list"></div>
      <div class="controls">
        <div></div>
        <button id="restartBtn" class="btn primary" type="button">Пройти еще раз</button>
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
<html lang="ru">
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
        <div class="meta-chip"><span id="linkLabel">Ссылка</span>${htmlEscape(folder)}</div>
        <div class="meta-chip"><span id="countLabel">Вопросов</span><strong id="quizLength">${quiz.questions.length}</strong></div>
      </div>
    </section>

    <section id="start" class="card">
      <h2 id="quizTitle" class="title">${htmlEscape(quiz.title)}</h2>
      <p id="introText" class="lead">Можно перемешать порядок вопросов. Варианты ответов будут перемешаны автоматически.</p>
      <div class="controls" style="justify-content:flex-start">
        <label class="small" style="display:flex;align-items:center;gap:10px;font-size:14px">
          <input type="checkbox" id="shuffle" />
          <span id="shuffleLabel">Перемешать вопросы</span>
        </label>
      </div>
      <div class="controls">
        <div></div>
        <button class="btn primary" id="startBtn" type="button">Начать</button>
      </div>
    </section>

    <section id="quiz" class="card hidden">
      <div class="small" id="questionCounter">Вопрос</div>
      <p id="qText" class="question"></p>
      <div id="options" class="options"></div>
      <div class="controls">
        <button id="finish" class="btn ghost" type="button">Завершить сейчас</button>
        <button id="next" class="btn secondary" type="button">Следующий</button>
      </div>
    </section>

    <section id="results" class="card hidden">
      <h2 id="resultsTitle" class="title">Результаты</h2>
      <div id="sum" class="summary"></div>
      <div id="resultsList" class="results-list"></div>
      <div class="controls">
        <div></div>
        <button id="restartBtn" class="btn primary" type="button">Пройти еще раз</button>
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
