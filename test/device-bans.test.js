import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

test('site device bans store reason and expire automatically', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdmu-device-bans-'));
  process.env.DATA_DIR = dataDir;

  const db = await import(`../src/db.js?deviceBans=${Date.now()}`);
  const created = db.banSiteDevice('device-123', 3, 'spam clicks');

  assert.equal(created.deviceId, 'device-123');
  assert.equal(created.reason, 'spam clicks');
  assert.ok(created.createdAt > 0);
  assert.ok(created.expiresAt > created.createdAt);
  assert.ok(created.remainingMs > 0);

  const active = db.getSiteDeviceBan('device-123', created.createdAt + 1000);
  assert.equal(active?.deviceId, 'device-123');

  const activeList = db.listSiteDeviceBans(10, created.createdAt + 1000);
  assert.equal(activeList.length, 1);
  assert.equal(activeList[0].deviceId, 'device-123');

  const expired = db.getSiteDeviceBan('device-123', created.expiresAt + 1);
  assert.equal(expired, null);
  assert.equal(db.listSiteDeviceBans(10, created.expiresAt + 1).length, 0);
});

test('site device bans can be removed manually', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdmu-device-unban-'));
  process.env.DATA_DIR = dataDir;

  const db = await import(`../src/db.js?deviceUnban=${Date.now()}`);
  db.banSiteDevice('device-xyz', 2, 'manual review');

  assert.equal(db.unbanSiteDevice('device-xyz'), true);
  assert.equal(db.getSiteDeviceBan('device-xyz'), null);
  assert.equal(db.unbanSiteDevice('device-xyz'), false);
});
