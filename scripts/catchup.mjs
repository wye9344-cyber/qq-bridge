#!/usr/bin/env node
// catchup.mjs — 睡醒补消息（关机=睡觉）。
//
// 场景：电脑关机期间，老大给机器人发了消息。QQ 会把这些消息留在会话历史里，
// 但 SnowLuma 的 OneBot 事件流只从连接之后开始推送，桥接不会自动补。
//
// 做法：桥接启动后，读取 owner 的最近私聊历史，找出“上一次运行之后、桥接本次
// 启动之前”还没有被回复的消息，通过 bridge 控制台的 notify-ai 发一条 silent
// 提醒；小鲸鱼用 qq-admin send-message 补回，最后输出 [SILENT]。
//
// 用法：
//   node scripts/catchup.mjs --once
//   node scripts/catchup.mjs --once --dry-run --since 2026-10-20T13:55:00+08:00 --bridge-ready 2026-10-20T14:15:00+08:00
//   node scripts/catchup.mjs --reset
//
// 关键参数：
//   --once                只跑一次（start-bridge 用这个）
//   --dry-run             只打印候选和 prompt，不发 notify-ai，不写 state
//   --reset               把 lastSeenMs 设成现在并退出（首次部署/清空基线）
//   --since ISO           覆盖 state.lastSeenMs（测试/补一段指定时间）
//   --bridge-ready ISO    覆盖本次桥接就绪时间（测试）
//   --ignore-replies      测试时忽略“已有机器人回复”过滤
//   --max N               一次最多列多少条，默认 8
//   --wait-sec N          等桥接/DSH 就绪最久多少秒，默认 120
//   --no-lock             不拿单实例锁（测试用）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const STATE_DIR = path.join(ROOT, 'state');
const STATE_PATH = path.join(STATE_DIR, 'catchup-state.json');
const LOCK_PATH = path.join(STATE_DIR, 'catchup.lock');
const LOG_PATH = path.join(STATE_DIR, 'catchup.log');
const CONSOLE_TOKEN_PATH = path.join(STATE_DIR, 'console-token');
const SNOWLUMA_CONFIG_DIR = path.join(ROOT, '..', 'SnowLuma', 'config');
const QQ_ADMIN = 'D:\\node.exe D:\\Temp\\qq-bridge\\scripts\\qq-admin.mjs';

function findOnebotConfig() {
  if (process.env.ONEBOT_CONFIG) return process.env.ONEBOT_CONFIG;
  try {
    const f = fs.readdirSync(SNOWLUMA_CONFIG_DIR).find((n) => /^onebot_\d+\.json$/.test(n));
    if (f) return path.join(SNOWLUMA_CONFIG_DIR, f);
  } catch {}
  return path.join(SNOWLUMA_CONFIG_DIR, 'onebot.json');
}
const ONEBOT_CONFIG = findOnebotConfig();

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const OPT = {
  once: Boolean(args.once),
  dryRun: Boolean(args.dryRun),
  reset: Boolean(args.reset),
  ignoreReplies: Boolean(args.ignoreReplies),
  noLock: Boolean(args.noLock),
  max: Number(args.max || 8),
  waitSec: Number(args.waitSec || 300),
  since: args.since ? new Date(args.since).getTime() : 0,
  bridgeReady: args.bridgeReady ? new Date(args.bridgeReady).getTime() : 0
};

function readJson(file) {
  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text);
}

function loadConfig() {
  try {
    return readJson(CONFIG_PATH);
  } catch {
    return {};
  }
}

function loadState() {
  const base = { version: 1, lastSeenMs: 0, lastRunAt: 0, lastCatchupAt: 0, lastBridgeReadyAt: 0 };
  try {
    return { ...base, ...readJson(STATE_PATH) };
  } catch {
    return base;
  }
}

function saveState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.appendFileSync(LOG_PATH, `${line}\n`, 'utf8');
  } catch {}
  console.log(line);
}

function consoleToken(cfg) {
  const fromConfig = String(cfg.consoleToken || '').trim();
  if (fromConfig) return fromConfig;
  try {
    return fs.readFileSync(CONSOLE_TOKEN_PATH, 'utf8').trim();
  } catch {
    return '';
  }
}

function consoleBase(cfg) {
  return `http://127.0.0.1:${Number(cfg.consolePort) || 3100}`;
}

async function bridgeStatus(cfg) {
  const token = consoleToken(cfg);
  if (!token) return null;
  try {
    const res = await fetch(`${consoleBase(cfg)}/api/status`, {
      headers: { 'x-console-token': token },
      signal: AbortSignal.timeout(5_000)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function waitForBridge(cfg) {
  if (OPT.bridgeReady) return { at: OPT.bridgeReady, status: null };
  const deadline = Date.now() + Math.max(10, OPT.waitSec) * 1000;
  for (;;) {
    const status = await bridgeStatus(cfg);
    if (status && status.dshReady && status.snowluma?.connected) {
      return { at: Date.now(), status };
    }
    if (Date.now() >= deadline) throw new Error(`等待桥接/DSH 就绪超时（${OPT.waitSec}s）`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

function oneBotConfig(cfg) {
  const httpUrl = String(cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  let token = String(cfg.snowluma?.accessToken || '');
  if (!token) {
    try {
      const ob = readJson(ONEBOT_CONFIG);
      token = String(ob?.http?.token || ob?.accessToken || '');
    } catch {}
  }
  return { httpUrl, token };
}

async function onebot(cfg, action, params = {}) {
  const { httpUrl, token } = oneBotConfig(cfg);
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${httpUrl}/${action}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(30_000)
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${action} 返回非 JSON（HTTP ${res.status}）`);
  }
  if (!res.ok || body.status === 'failed' || body.retcode !== 0) {
    throw new Error(`${action} 失败：${body.wording || body.message || text.slice(0, 200)}`);
  }
  return body.data;
}

async function notifyAi(cfg, ownerQQ, message) {
  const token = consoleToken(cfg);
  if (!token) throw new Error('缺少 consoleToken');
  const res = await fetch(`${consoleBase(cfg)}/api/console/notify-ai`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-console-token': token
    },
    body: JSON.stringify({ key: `private:${ownerQQ}`, message }),
    signal: AbortSignal.timeout(30_000)
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`notify-ai 返回非 JSON（HTTP ${res.status}）`);
  }
  if (!res.ok || !body.ok) {
    throw new Error(`notify-ai 失败（HTTP ${res.status}）：${body.error || text.slice(0, 200)}`);
  }
  return body;
}

function toMs(value) {
  let ts = Number(value) || 0;
  if (ts > 0 && ts < 1e12) ts *= 1000;
  return ts;
}

function messageText(m) {
  const raw = String(m?.raw_message || '').trim();
  if (raw) {
    return raw.replace(/\[CQ:[^\]]+\]/g, '[消息]').replace(/\s+/g, ' ').trim().slice(0, 180);
  }
  const parts = Array.isArray(m?.message) ? m.message : [];
  const text = parts
    .map((p) => (p?.type === 'text' ? p?.data?.text : p?.type === 'image' ? '[图片]' : p?.type === 'face' ? '[表情]' : ''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 180) || '[非文字消息]';
}

function formatTime(ms) {
  return new Date(ms).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function buildPrompt(ownerQQ, messages) {
  const shown = messages.slice(-OPT.max);
  const hidden = messages.length - shown.length;
  const lines = shown.map((m) => `- ${formatTime(m.ms)}：${m.text}`);
  return [
    '【睡醒补消息】你刚睡醒。电脑关机的这段时间，对你来说就是睡觉；这不是老大现在发的新消息，是他在你睡觉期间发的消息，刚被系统从会话历史里找出来。',
    hidden > 0 ? `（更早有 ${hidden} 条，未列出；只补最近 ${shown.length} 条。）` : '',
    `老大在你睡觉期间发了 ${messages.length} 条：`,
    ...lines,
    '',
    '请像刚看到一样自然补回一次，不要逐条机械复读，不要解释“睡过头/关机/离线/系统/刚开机”，也不要把这些当成现在正在发生的事。如果内容已经过时，就轻轻带过。',
    `必须用这条命令发出去：${QQ_ADMIN} send-message --user ${ownerQQ} --text "..."`,
    '不要直接输出要发到 QQ 的正文；不要用 MCP 发文字。发完只输出 [SILENT]。'
  ]
    .filter((line, i) => !(i === 1 && !line))
    .join('\n');
}

function acquireLock() {
  if (OPT.noLock) return true;
  try {
    const pid = Number(fs.readFileSync(LOCK_PATH, 'utf8').trim());
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        return false;
      } catch {}
    }
  } catch {}
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(LOCK_PATH, String(process.pid), 'utf8');
  } catch {}
  return true;
}

function releaseLock() {
  if (OPT.noLock) return;
  try {
    const pid = Number(fs.readFileSync(LOCK_PATH, 'utf8').trim());
    if (pid === process.pid) fs.unlinkSync(LOCK_PATH);
  } catch {}
}

async function runOnce() {
  const cfg = loadConfig();
  const ownerQQ = Number(cfg.ownerQQ);
  if (!ownerQQ) throw new Error('config.json 缺少 ownerQQ');

  const state = loadState();
  if (OPT.reset) {
    state.lastSeenMs = Date.now();
    state.lastRunAt = Date.now();
    saveState(state);
    log('已重置基线（lastSeenMs=now）');
    return;
  }

  const baseline = state.lastSeenMs || 0;
  if (!baseline && !OPT.since) {
    state.lastSeenMs = Date.now();
    state.lastRunAt = Date.now();
    saveState(state);
    log('首次运行：已建立基线，不补旧消息（以后关机期间的消息会补）');
    return;
  }

  const ready = await waitForBridge(cfg);
  const bridgeAt = ready.at;
  if (ready.status) {
    if (ready.status.mode !== 'closed-agent') {
      log(`当前 mode=${ready.status.mode}，不是 closed-agent，跳过`);
      return;
    }
    if (!ready.status.role) {
      log('当前没有角色，跳过');
      return;
    }
  }

  const history = await onebot(cfg, 'get_friend_msg_history', { user_id: ownerQQ, count: 100 });
  const list = Array.isArray(history?.messages) ? history.messages : [];
  const ownerMsgs = list
    .filter((m) => Number(m?.user_id) === ownerQQ)
    .map((m) => ({ ms: toMs(m.time), text: messageText(m), id: String(m.message_id || '') }))
    .filter((m) => m.ms > 0 && m.text)
    .sort((a, b) => a.ms - b.ms);
  const botMsgs = list
    .filter((m) => Number(m?.user_id) !== ownerQQ)
    .map((m) => ({ ms: toMs(m.time) }))
    .filter((m) => m.ms > 0)
    .sort((a, b) => a.ms - b.ms);

  const since = OPT.since || baseline;
  const cutoff = bridgeAt - 5_000;
  const lastBotBefore = botMsgs.reduce((max, m) => (m.ms < cutoff && m.ms > max ? m.ms : max), 0);
  let candidates = ownerMsgs.filter((m) => m.ms > since && m.ms < cutoff);
  if (!OPT.ignoreReplies && lastBotBefore) {
    candidates = candidates.filter((m) => m.ms > lastBotBefore);
  }

  log(
    `检查：since=${new Date(since).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })} ` +
      `bridgeAt=${new Date(bridgeAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })} ` +
      `ownerMsgs=${ownerMsgs.length} candidates=${candidates.length}`
  );

  if (!candidates.length) {
    state.lastSeenMs = Date.now();
    state.lastRunAt = Date.now();
    state.lastBridgeReadyAt = bridgeAt;
    saveState(state);
    log('没有需要补的消息');
    return;
  }

  const prompt = buildPrompt(ownerQQ, candidates);
  if (OPT.dryRun) {
    console.log('\n--- CATCHUP PROMPT ---\n');
    console.log(prompt);
    console.log('\n--- END ---');
    return;
  }

  await notifyAi(cfg, ownerQQ, prompt);
  state.lastSeenMs = Date.now();
  state.lastRunAt = Date.now();
  state.lastCatchupAt = Date.now();
  state.lastBridgeReadyAt = bridgeAt;
  saveState(state);
  log(`已发出补消息提醒：${candidates.length} 条（最后 ${formatTime(candidates[candidates.length - 1].ms)}）`);
}

async function main() {
  if (!acquireLock()) {
    log('已有 catchup 实例在运行，跳过');
    return;
  }
  try {
    if (OPT.once || OPT.dryRun || OPT.reset) {
      await runOnce();
      return;
    }
    await runOnce();
  } finally {
    releaseLock();
  }
}

main().catch((error) => {
  log(`错误：${error.message}`);
  process.exitCode = 1;
});
