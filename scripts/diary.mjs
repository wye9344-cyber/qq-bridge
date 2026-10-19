#!/usr/bin/env node
// diary.mjs — 小鲸鱼的每日日记守护。
//
// 规则：
// - 每天 00:00 之后，为“昨天”触发一次 silent 日记任务；
// - 她自己判断写多少条，不固定条数；
// - 只追加，不覆盖；不自动发 QQ；
// - 电脑关机/桥接没开时，下次启动补记；
// - 每天 08:00 后，第一次启动时 silent 读最近 7 天日记，作为当天记忆。
//
// 用法：
//   node scripts/diary.mjs --dry-run --force --date 2026-10-19
//   node scripts/diary.mjs --once --force --date 2026-10-19
//   node scripts/diary.mjs
//
// 参数：
//   --once             只检查一次就退出
//   --dry-run          只打印提示词，不唤醒
//   --force            跳过“已写过”检查，强制触发（测试用）
//   --read             只做晨读，不写日记（测试/手动补读）
//   --no-lock          不拿单实例锁（测试用）
//   --date YYYY-MM-DD  指定日记日期（测试/补记用）
//   --read-hour H      默认 8：每天这个点之后才读日记
//   --interval-ms N    默认 300000（5 分钟）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const STATE_DIR = path.join(ROOT, 'state');
const STATE_PATH = path.join(STATE_DIR, 'diary-state.json');
const LOCK_PATH = path.join(STATE_DIR, 'diary.lock');
const CONSOLE_TOKEN_PATH = path.join(STATE_DIR, 'console-token');
const DIARY_PATH = path.join(STATE_DIR, '小鲸鱼-日记.md');
const LOG_PATH = path.join(STATE_DIR, 'diary.log');

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
  readOnly: !!args.read,
  noLock: !!args.noLock,
  date: args.date ? String(args.date) : '',
  readHour: Math.min(23, Math.max(0, Number(args.readHour ?? 8))),
  intervalMs: Math.max(10_000, Number(args.intervalMs ?? 300_000))
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
  const base = { version: 1, lastDiaryDate: '', lastDiaryAt: 0, lastReadDate: '', lastReadAt: 0 };
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

function dateKey(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
}

function addDays(key, n) {
  const d = new Date(`${key}T12:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return dateKey(d);
}

function localHour() {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false
  }).format(new Date())) % 24;
}

function localTime() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
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

async function notifyAi(cfg, ownerQQ, message) {
  const token = consoleToken(cfg);
  if (!token) throw new Error('缺少 consoleToken');
  const res = await fetch(`${consoleBase(cfg)}/api/console/notify-ai`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-console-token': token
    },
    body: JSON.stringify({ key: `private:${ownerQQ}`, message, silent: true }),
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

function buildDiaryPrompt({ target, from }) {
  const range = from && from < target ? `\n这是补记：从 ${from} 到 ${target}，挑你还记得的、真正重要的写；记不清就少写或写一句。` : '';
  return [
    `【日记时间】现在是 ${localTime()}，请回顾 ${target} 这一天和老大聊的内容。${range}`,
    '',
    '你自己判断有多少件值得记的事，不限定条数。',
    '优先记：新的事实、约定、老大的偏好/禁忌、重要日期、你自己的承诺、关系或情绪上的变化。',
    '不要写流水账，不要记密码/token，不要把聊天记录整段抄进去。',
    '',
    `把日记追加到 ${DIARY_PATH}，日期标题用 “## ${target}”；不要覆盖旧内容。`,
    '如果这一天没有值得记的，可以只写一句“今天没什么特别”，或者跳过。',
    '',
    '不要发 QQ，不要提这条提醒。写完后只输出 [SILENT]。'
  ].join('\n');
}

function buildReadPrompt() {
  return [
    `【日记·晨读】现在是 ${localTime()}。`,
    `先读 ${DIARY_PATH} 最近 7 天的内容，记住和老大有关的重要设定、约定和偏好。`,
    '不要回复，不要发 QQ。完成后只输出 [SILENT]。'
  ].join('\n');
}

function acquireLock() {
  try {
    const pid = Number(fs.readFileSync(LOCK_PATH, 'utf8').trim());
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        log(`已有日记进程在运行（pid=${pid}），退出。`);
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

    const status = await bridgeStatus(cfg);
    if (status.mode !== 'closed-agent') {
      log(`跳过：当前 mode=${status.mode}，不是 closed-agent`);
      return;
    }
    if (status.role !== '小鲸鱼') {
      log(`跳过：当前 role=${status.role ?? 'null'}，不是小鲸鱼`);
      return;
    }
    if (status.dshReady === false) {
      log('跳过：DSH 未就绪');
      return;
    }

    const state = loadState();
    const today = dateKey();
    const yesterday = addDays(today, -1);
    const target = OPT.date || yesterday;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) throw new Error(`日期格式不对：${target}`);
    if (target > today) throw new Error(`日记日期不能是未来：${target}`);

    const needDiary = !OPT.readOnly && (OPT.force || !state.lastDiaryDate || state.lastDiaryDate < target);
    if (needDiary) {
      const from = state.lastDiaryDate && state.lastDiaryDate < target
        ? addDays(state.lastDiaryDate, 1)
        : target;
      const prompt = buildDiaryPrompt({ target, from });
      if (OPT.dryRun) {
        log(`DRY-RUN 日记 ${target}，prompt：`);
        console.log(prompt);
        return;
      }
      await notifyAi(cfg, ownerQQ, prompt);
      state.lastDiaryDate = target;
      state.lastDiaryAt = Date.now();
      saveState(state);
      log(`已触发日记 ${target}（from=${from}）`);
      return;
    }

    const hour = localHour();
    const needRead = OPT.readOnly || ((OPT.force || hour >= OPT.readHour) && state.lastReadDate !== today);
    if (needRead) {
      const prompt = buildReadPrompt();
      if (OPT.dryRun) {
        log('DRY-RUN 晨读，prompt：');
        console.log(prompt);
        return;
      }
      await notifyAi(cfg, ownerQQ, prompt);
      state.lastReadDate = today;
      state.lastReadAt = Date.now();
      saveState(state);
      log(`已触发晨读 ${today}`);
    }
  } catch (error) {
    log(`日记检查失败：${error.message}`);
  } finally {
    busy = false;
  }
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
  log(`日记守护启动：每 ${Math.round(OPT.intervalMs / 60_000)} 分钟检查；00:00 后写昨天；${OPT.readHour}:00 后晨读。`);
  await tick();
  setInterval(() => { void tick(); }, OPT.intervalMs);
}
