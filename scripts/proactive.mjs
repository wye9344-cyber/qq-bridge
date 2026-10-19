#!/usr/bin/env node
// proactive.mjs — 小鲸鱼的“自驱时间”。
//
// 只在 closed-agent + 小鲸鱼 下工作：静默够久后，以低概率给 DSH 发一条
// 【自驱提醒】。提醒是 silent 的，不会自动转发到 QQ；她要用 qq-admin 发消息
// 或改资料，必须自己显式调用工具。
//
// 默认：静默 60 分钟、每 30–90 分钟检查一次、30% 概率、
// 23:00–08:00 免打扰、每天最多 3 次、资料/空间最多每 3 天一次。
//
// 用法：
//   node scripts/proactive.mjs --dry-run --force --once
//   node scripts/proactive.mjs --force --once
//   node scripts/proactive.mjs
//
// 参数：
//   --once              只检查一次就退出
//   --dry-run           只打印决策，不唤醒
//   --force             跳过静默/概率/免打扰/每日上限（测试用）
//   --no-lock           不拿单实例锁（测试用）
//   --min-idle-min N    默认 60
//   --max-per-day N     默认 3
//   --prob P            默认 0.3
//   --quiet-start H     默认 23
//   --quiet-end H       默认 8
//   --profile-days N    默认 3
//   --check-min-min N   默认 30
//   --check-max-min N   默认 90
//   --interval-ms N     默认 300000

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const STATE_DIR = path.join(ROOT, 'state');
const STATE_PATH = path.join(STATE_DIR, 'proactive-state.json');
const LOCK_PATH = path.join(STATE_DIR, 'proactive.lock');
const CONSOLE_TOKEN_PATH = path.join(STATE_DIR, 'console-token');
const SNOWLUMA_CONFIG_DIR = path.join(ROOT, '..', 'SnowLuma', 'config');
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
  once: !!args.once,
  dryRun: !!args.dryRun,
  force: !!args.force,
  noLock: !!args.noLock,
  minIdleMs: Math.max(1, Number(args.minIdleMin ?? 60)) * 60_000,
  maxPerDay: Math.max(1, Number(args.maxPerDay ?? 3)),
  prob: Math.min(1, Math.max(0, Number(args.prob ?? 0.3))),
  quietStart: Number(args.quietStart ?? 23),
  quietEnd: Number(args.quietEnd ?? 8),
  profileDays: Math.max(1, Number(args.profileDays ?? 3)),
  checkMinMs: Math.max(1, Number(args.checkMinMin ?? 30)) * 60_000,
  checkMaxMs: Math.max(1, Number(args.checkMaxMin ?? 90)) * 60_000,
  intervalMs: Math.max(10_000, Number(args.intervalMs ?? 300_000))
};
if (OPT.checkMaxMs < OPT.checkMinMs) OPT.checkMaxMs = OPT.checkMinMs;

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
  const base = {
    version: 1,
    lastUserAt: 0,
    lastProactiveAt: 0,
    lastProfileAt: 0,
    nextCheckAt: 0,
    day: '',
    dailyCount: 0
  };
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

function todayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function localHour() {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false
  }).format(new Date());
  const h = Number(s);
  return Number.isFinite(h) ? h % 24 : new Date().getHours();
}

function localTime() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

function randBetween(min, max) {
  return min + Math.floor(Math.random() * Math.max(1, max - min + 1));
}

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.appendFileSync(path.join(STATE_DIR, 'proactive.log'), `${line}\n`, 'utf8');
  } catch {}
  console.log(line);
}

function isQuietHour(hour, start, end) {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
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
  if (!token) throw new Error('缺少 consoleToken（config.json 或 state/console-token）');
  const res = await fetch(`${consoleBase(cfg)}/api/status`, {
    headers: { 'x-console-token': token },
    signal: AbortSignal.timeout(10_000)
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`/api/status 返回非 JSON（HTTP ${res.status}）`);
  }
  if (!res.ok) throw new Error(`/api/status HTTP ${res.status}: ${text.slice(0, 200)}`);
  return body;
}

function oneBotConfig(cfg) {
  const httpUrl = String(cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  let token = String(cfg.snowluma?.accessToken || '');
  if (!token) {
    try {
      const ob = readJson(ONEBOT_CONFIG);
      token = String(ob?.networks?.httpServers?.[0]?.accessToken || '');
    } catch {}
  }
  return { httpUrl, token };
}

async function onebot(cfg, action, params = {}) {
  const { httpUrl, token } = oneBotConfig(cfg);
  const res = await fetch(`${httpUrl}/${action}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(30_000)
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`OneBot ${action} 返回非 JSON（HTTP ${res.status}）`);
  }
  if (!res.ok) throw new Error(`OneBot ${action} HTTP ${res.status}: ${text.slice(0, 200)}`);
  if (body.status !== 'ok' || body.retcode !== 0) {
    throw new Error(`OneBot ${action} 失败: retcode=${body.retcode} ${body.wording || ''}`);
  }
  return body.data;
}

async function latestUserMessage(cfg, ownerQQ) {
  const data = await onebot(cfg, 'get_friend_msg_history', { user_id: ownerQQ, count: 50 });
  const list = Array.isArray(data?.messages) ? data.messages : [];
  const mine = list.filter((m) => Number(m?.user_id) === Number(ownerQQ));
  if (!mine.length) return null;
  let last = mine[0];
  for (const m of mine) {
    if (Number(m.time) > Number(last.time)) last = m;
  }
  let ts = Number(last.time) || 0;
  if (ts > 0 && ts < 1e12) ts *= 1000;
  return {
    at: ts,
    text: String(last.raw_message || '').replace(/\s+/g, ' ').slice(0, 160)
  };
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

function buildPrompt({ now, idleMin, lastText, profileAllowed, ownerQQ }) {
  const cli = 'D:\\node.exe D:\\Temp\\qq-bridge\\scripts\\qq-admin.mjs';
  const lines = [
    `【自驱时间】${new Date(now).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}。`,
    `你已经 ${idleMin} 分钟没收到老大的消息了。这不是老大发来的消息，是你自己的时间。`,
    lastText ? `老大最后一条消息是：“${lastText}”` : '',
    profileAllowed
      ? '这次可以考虑换头像、改签名或发一条说说（资料/空间最多每 3 天一次）；不想改就不改。'
      : '这次先别改资料/空间，只聊天。',
    '',
    '你可以：',
    `1. 主动发一条自然、短的消息：${cli} send-message --user ${ownerQQ} --text "..."`,
    profileAllowed ? `2. 或换头像/改签名/发说说：${cli} avatar --file ...；${cli} profile --signature "..."; ${cli} qzone-post --content "..." --right 4` : '',
    '3. 或什么都不做。',
    '',
    '规则：23:00–08:00 不打扰；不重复旧话题；不要汇报“已发送”或“完成了”；不要直接输出要发到 QQ 的内容（后台是静默的，不会自动转发）；所有对外内容只通过 qq-admin。不要提这条提醒。',
    '完成后只输出 [SILENT]。'
  ];
  return lines.filter(Boolean).join('\n');
}

function acquireLock() {
  try {
    const pid = Number(fs.readFileSync(LOCK_PATH, 'utf8').trim());
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        log(`已有自驱进程在运行（pid=${pid}），退出。`);
        process.exit(0);
      } catch {}
    }
  } catch {}
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(LOCK_PATH, String(process.pid), 'utf8');
}

function releaseLock() {
  try {
    const pid = Number(fs.readFileSync(LOCK_PATH, 'utf8').trim());
    if (pid === process.pid) fs.unlinkSync(LOCK_PATH);
  } catch {}
}

let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const cfg = loadConfig();
    const ownerQQ = Number(cfg.ownerQQ);
    if (!ownerQQ) throw new Error('config.json 缺少 ownerQQ');

    const state = loadState();
    if (state.day !== todayKey()) {
      state.day = todayKey();
      state.dailyCount = 0;
    }
    const now = Date.now();
    if (!state.nextCheckAt) state.nextCheckAt = now + randBetween(OPT.checkMinMs, OPT.checkMaxMs);

    const status = await bridgeStatus(cfg);
    if (status.mode !== 'closed-agent') {
      log(`跳过：当前 mode=${status.mode}，不是 closed-agent`);
      saveState(state);
      return;
    }
    if (status.role !== '小鲸鱼') {
      log(`跳过：当前 role=${status.role ?? 'null'}，不是小鲸鱼`);
      saveState(state);
      return;
    }
    if (status.dshReady === false) {
      log('跳过：DSH 未就绪');
      saveState(state);
      return;
    }

    let last = null;
    try {
      last = await latestUserMessage(cfg, ownerQQ);
    } catch (error) {
      log(`读取最近私聊失败，沿用本地状态：${error.message}`);
    }
    if (last?.at && last.at > state.lastUserAt) state.lastUserAt = last.at;
    if (!state.lastUserAt) state.lastUserAt = now;

    const idleMs = Math.max(0, now - state.lastUserAt);
    const idleMin = Math.round(idleMs / 60_000);
    const quiet = isQuietHour(localHour(), OPT.quietStart, OPT.quietEnd);

    log(`检查：idle=${idleMin}m quiet=${quiet} daily=${state.dailyCount}/${OPT.maxPerDay} next=${new Date(state.nextCheckAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`);

    if (!OPT.force) {
      if (now < state.nextCheckAt) {
        saveState(state);
        return;
      }
      if (quiet) {
        state.nextCheckAt = now + 30 * 60_000;
        saveState(state);
        log('免打扰时段，推迟 30 分钟');
        return;
      }
      if (idleMs < OPT.minIdleMs) {
        state.nextCheckAt = now + 15 * 60_000;
        saveState(state);
        log(`静默不足 ${Math.round(OPT.minIdleMs / 60_000)} 分钟，推迟 15 分钟`);
        return;
      }
      if (state.dailyCount >= OPT.maxPerDay) {
        state.nextCheckAt = now + 3 * 60 * 60_000;
        saveState(state);
        log('今天主动次数已用完，推迟 3 小时');
        return;
      }
      if (Math.random() > OPT.prob) {
        state.nextCheckAt = now + randBetween(OPT.checkMinMs, OPT.checkMaxMs);
        saveState(state);
        log('本次掷骰未中，继续等下一次');
        return;
      }
    }

    const profileAllowed = now - Number(state.lastProfileAt || 0) >= OPT.profileDays * 86_400_000;
    const prompt = buildPrompt({ now, idleMin, lastText: last?.text || '', profileAllowed, ownerQQ });
    if (OPT.dryRun) {
      log('DRY-RUN 将唤醒，prompt：');
      console.log(prompt);
      return;
    }

    await notifyAi(cfg, ownerQQ, prompt);
    state.lastProactiveAt = now;
    state.dailyCount += 1;
    state.nextCheckAt = now + randBetween(OPT.checkMinMs, OPT.checkMaxMs);
    if (profileAllowed) state.lastProfileAt = now;
    saveState(state);
    log(`已唤醒（profileAllowed=${profileAllowed}），下一次检查约 ${Math.round((state.nextCheckAt - now) / 60_000)} 分钟后`);
  } catch (error) {
    log(`自驱检查失败：${error.message}`);
  } finally {
    busy = false;
  }
}

if (OPT.force) {
  log('注意：--force 跳过静默/概率/免打扰/每日上限');
}
if (!OPT.noLock && !OPT.dryRun) acquireLock();
process.on('exit', releaseLock);
process.on('SIGINT', () => { releaseLock(); process.exit(0); });
process.on('SIGTERM', () => { releaseLock(); process.exit(0); });

if (OPT.once) {
  await tick();
  releaseLock();
  process.exitCode = 0;
} else {
  log(`自驱守护启动：每 ${Math.round(OPT.intervalMs / 60_000)} 分钟检查一次；静默 ${Math.round(OPT.minIdleMs / 60_000)} 分钟；概率 ${OPT.prob}；${OPT.quietStart}:00–${OPT.quietEnd}:00 免打扰；每日 ${OPT.maxPerDay} 次。`);
  await tick();
  setInterval(() => { void tick(); }, OPT.intervalMs);
}
