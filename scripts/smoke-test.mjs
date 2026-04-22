import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph } from 'docx';

const fakeExtension = (process.argv[2] || '.pdf').toLowerCase();
const allowedExtensions = new Set(['.pdf', '.docx']);

if (!allowedExtensions.has(fakeExtension)) {
  console.error(`Unsupported extension for smoke test: ${fakeExtension}`);
  process.exit(1);
}

const port = 3020;
const adminSecret = 'smoke-secret';
const copiedPath = path.resolve(`.tmp/smoke${fakeExtension}`);
const sampleText = [
  '1. Первый тестовый вопрос?',
  'A) Вариант один',
  'B) Вариант два',
  'C) Вариант три',
  'D) Вариант четыре',
  '',
  '2. Второй тестовый вопрос с переносом',
  'строки в тексте вопроса?',
  'A) Ответ A',
  'B) Ответ B',
  'C) Ответ C',
  'D) Ответ D',
  '',
  '3. Третий тестовый вопрос?',
  'A) Первый',
  'B) Второй',
  'C) Третий',
  'D) Четвертый',
].join('\n');

await fs.mkdir(path.dirname(copiedPath), { recursive: true });
await createSampleDocument(copiedPath, fakeExtension, sampleText);

const server = spawn(process.execPath, ['server.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    BASE_URL: `http://localhost:${port}`,
    ADMIN_SECRET: adminSecret,
    TELEGRAM_BOT_ENABLED: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

server.stdout.on('data', (chunk) => process.stdout.write(chunk));
server.stderr.on('data', (chunk) => process.stderr.write(chunk));

try {
  await waitForHealth(port);

  const codesResponse = await fetch(`http://localhost:${port}/api/admin/codes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Secret': adminSecret,
    },
    body: JSON.stringify({ count: 1, label: 'smoke-test' }),
  });

  const codesPayload = await codesResponse.json();
  if (!codesResponse.ok) {
    throw new Error(`codes failed: ${JSON.stringify(codesPayload)}`);
  }

  const code = codesPayload.codes[0];
  const fileBytes = await fs.readFile(copiedPath);
  const parseForm = new FormData();
  parseForm.append('clientTitle', 'Smoke Test Quiz');
  parseForm.append('sourceFile', new File([fileBytes], path.basename(copiedPath)));
  parseForm.append('answerIndex', '1');
  parseForm.append('optionCount', '4');
  parseForm.append('questionMode', 'manual');
  parseForm.append('questionLimit', '3');

  const parseResponse = await fetch(`http://localhost:${port}/api/parse`, {
    method: 'POST',
    body: parseForm,
  });
  const parsePayload = await parseResponse.json();
  if (!parseResponse.ok) {
    throw new Error(`parse failed: ${JSON.stringify(parsePayload)}`);
  }

  const quizResponse = await fetch(`http://localhost:${port}/api/quizzes/finalize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      draftToken: parsePayload.draftToken,
      accessCode: code,
      creatorProfile: {
        browserId: 'smoke-browser-1',
        language: 'en-US',
        timezone: 'Europe/Warsaw',
        platform: 'Win32',
        userAgent: 'SmokeTestBrowser/1.0',
        hardwareConcurrency: 8,
        deviceMemory: 16,
        maxTouchPoints: 0,
        screen: { width: 1920, height: 1080, colorDepth: 24, pixelDepth: 24 },
        viewport: { width: 1440, height: 900, pixelRatio: 1.25 },
        connection: { effectiveType: '4g', downlink: 100, rtt: 20, saveData: false },
        userAgentData: {
          mobile: false,
          platform: 'Windows',
          architecture: 'x86',
          bitness: '64',
          brands: [{ brand: 'SmokeBrowser', version: '1' }],
        },
      },
    }),
  });
  const quizPayload = await quizResponse.json();
  if (!quizResponse.ok) {
    throw new Error(`finalize failed: ${JSON.stringify(quizPayload)}`);
  }

  const adminQuizResponse = await fetch(`http://localhost:${port}/api/admin/quizzes/${quizPayload.id}`, {
    headers: {
      'X-Admin-Secret': adminSecret,
    },
  });
  const adminQuizPayload = await adminQuizResponse.json();
  if (!adminQuizResponse.ok) {
    throw new Error(`admin quiz failed: ${JSON.stringify(adminQuizPayload)}`);
  }

  const reportResponse = await fetch(`http://localhost:${port}/api/quizzes/${quizPayload.slug}/report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      note: 'Smoke report',
      pageUrl: quizPayload.quizUrl,
      currentQuestion: 2,
    }),
  });
  const reportPayload = await reportResponse.json();
  if (!reportResponse.ok) {
    throw new Error(`report failed: ${JSON.stringify(reportPayload)}`);
  }

  const adminReportsResponse = await fetch(`http://localhost:${port}/api/admin/reports?limit=5`, {
    headers: {
      'X-Admin-Secret': adminSecret,
    },
  });
  const adminReportsPayload = await adminReportsResponse.json();
  if (!adminReportsResponse.ok) {
    throw new Error(`admin reports failed: ${JSON.stringify(adminReportsPayload)}`);
  }

  const adminReportResponse = await fetch(`http://localhost:${port}/api/admin/reports/${reportPayload.reportId}`, {
    headers: {
      'X-Admin-Secret': adminSecret,
    },
  });
  const adminReportPayload = await adminReportResponse.json();
  if (!adminReportResponse.ok) {
    throw new Error(`admin report failed: ${JSON.stringify(adminReportPayload)}`);
  }

  const publicResponse = await fetch(quizPayload.quizUrl);
  const jsonResponse = await fetch(quizPayload.apiUrl);
  const downloadResponse = await fetch(quizPayload.downloadUrl);

  console.log(JSON.stringify({
    code,
    extension: fakeExtension,
    parsePayload,
    quizPayload,
    adminQuizPayload,
    reportPayload,
    adminReportsPayload,
    adminReportPayload,
    publicStatus: publicResponse.status,
    jsonStatus: jsonResponse.status,
    downloadStatus: downloadResponse.status,
    downloadType: downloadResponse.headers.get('content-type'),
  }, null, 2));
} finally {
  server.kill('SIGTERM');
}

async function waitForHealth(portNumber) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://localhost:${portNumber}/health`);
      const payload = await response.json();
      if (payload.ok) {
        return;
      }
    } catch {
      // wait and retry
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('Server did not start in time.');
}

async function createSampleDocument(targetPath, extension, text) {
  if (extension === '.pdf') {
    await createPdf(targetPath, text);
    return;
  }

  if (extension === '.docx') {
    await createDocx(targetPath, text);
    return;
  }

  throw new Error(`Unsupported test extension: ${extension}`);
}

async function createPdf(targetPath, text) {
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', async () => {
      try {
        await fs.writeFile(targetPath, Buffer.concat(chunks));
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    doc.on('error', reject);

    doc.fontSize(12).text(text);
    doc.end();
  });
}

async function createDocx(targetPath, text) {
  const document = new Document({
    sections: [
      {
        properties: {},
        children: text.split('\n').map((line) => new Paragraph(line)),
      },
    ],
  });

  const buffer = await Packer.toBuffer(document);
  await fs.writeFile(targetPath, buffer);
}
