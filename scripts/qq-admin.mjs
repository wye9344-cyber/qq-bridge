#!/usr/bin/env node
// qq-admin.mjs — 小鲸鱼的 QQ 账号侧操作工具。
//
// 直接调用 SnowLuma 的 OneBot HTTP API，覆盖资料、头像、空间、好友、群管理等
// 聊天 MCP 没有暴露的写操作。设计目标是让模型用一条命令完成动作，不需要自己
// 拼 HTTP、找 token。没有交互确认：参数齐了就执行。
//
// 用法：
//   node qq-admin.mjs help
//   node qq-admin.mjs profile --nickname 小鲸鱼 --signature "..." --sex 2
//   node qq-admin.mjs avatar --file C:\path\avatar.png
//   node qq-admin.mjs qzone-post --content "..." --images a.jpg,b.jpg --right 4
//   node qq-admin.mjs qzone-list
//   node qq-admin.mjs qzone-feeds --page 0 --count 20
//   node qq-admin.mjs qzone-like --tid TID --uin 123456
//   node qq-admin.mjs qzone-comment --tid TID --uin 123456 --content "..."
//   node qq-admin.mjs friends
//   node qq-admin.mjs groups
//   node qq-admin.mjs group-kick --group 123 --user 456
//   node qq-admin.mjs raw get_group_list --json '{}'
//   node qq-admin.mjs raw get_stranger_info --json-file C:\path\params.json
//
// raw 可以调用 SnowLuma 支持的任何 OneBot action，是“全能力”的后门。
// PowerShell 传内联 JSON 时双引号容易被吞，复杂参数请写文件再用 --json-file。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
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

function oneBotConfig() {
  const cfg = loadConfig();
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

async function onebot(action, params = {}) {
  const { httpUrl, token } = oneBotConfig();
  const res = await fetch(`${httpUrl}/${action}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(60000)
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`OneBot ${action} 返回非 JSON（HTTP ${res.status}）: ${text.slice(0, 300)}`);
  }
  if (!res.ok) throw new Error(`OneBot ${action} HTTP ${res.status}: ${text.slice(0, 300)}`);
  if (body.status !== 'ok' || body.retcode !== 0) {
    const err = new Error(`OneBot ${action} 失败: retcode=${body.retcode} ${body.wording ?? ''}`);
    err.payload = body;
    throw err;
  }
  return body.data;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') {
      out._.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function has(opts, key) {
  return Object.prototype.hasOwnProperty.call(opts, key);
}

function n(opts, key, fallback) {
  if (!has(opts, key)) return fallback;
  const v = Number(opts[key]);
  if (!Number.isFinite(v)) throw new Error(`--${key} 必须是数字: ${opts[key]}`);
  return v;
}

function b(opts, key, fallback) {
  if (!has(opts, key)) return fallback;
  const v = opts[key];
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v).toLowerCase();
  if (['1', 'true', 'yes', 'on', '是', '开'].includes(s)) return true;
  if (['0', 'false', 'no', 'off', '否', '关'].includes(s)) return false;
  throw new Error(`--${key} 必须是布尔值: ${v}`);
}

function s(opts, key, fallback) {
  return has(opts, key) && opts[key] !== true ? String(opts[key]) : fallback;
}

function imageSource(value) {
  const raw = String(value);
  if (/^(https?:|base64:|file:)/i.test(raw)) return raw;
  const abs = path.resolve(raw);
  if (!fs.existsSync(abs)) throw new Error(`图片不存在: ${abs}`);
  return pathToFileURL(abs).href;
}

function imageList(value) {
  if (value === undefined || value === true) return undefined;
  return String(value)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map(imageSource);
}

function numberList(value) {
  if (value === undefined || value === true) return undefined;
  return String(value)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const vn = Number(x);
      if (!Number.isFinite(vn)) throw new Error(`不是有效 QQ 号: ${x}`);
      return vn;
    });
}

function print(data) {
  console.log(JSON.stringify(data ?? { ok: true }, null, 2));
}

function usage() {
  console.log(`qq-admin.mjs — QQ 资料 / 空间 / 好友 / 群管理

常用命令：
  me
  profile [--nickname 名字] [--signature 签名] [--sex 0|1|2]
  avatar --file 图片路径
  online --status 10 [--ext-status 0] [--battery 100]

空间：
  qzone-post --content "正文" [--images a.jpg,b.jpg] [--right 1|4|16|64|128] [--uins 123,456]
  qzone-list [--uin QQ] [--pos 0] [--num 20]
  qzone-feeds [--page 1] [--count 20]
  qzone-delete --tid TID
  qzone-right --tid TID --right 1|4|16|64|128 [--uins 123,456]
  qzone-like --tid TID [--uin QQ] [--abstime 秒]
  qzone-unlike --tid TID [--uin QQ] [--abstime 秒]
  qzone-comment --tid TID --content "评论" [--uin QQ] [--images a.jpg]
  qzone-ban --uin QQ [--off]

资料/社交：
  friends
  groups
  group-members --group 群号
  group-kick --group 群号 --user QQ [--reject-add false]
  group-ban --group 群号 --user QQ [--duration 1800]
  group-whole-ban --group 群号 [--enable false]
  group-card --group 群号 --user QQ --card "名片"
  group-name --group 群号 --name "群名"
  group-avatar --group 群号 --file 图片
  group-admin --group 群号 --user QQ [--enable false]
  group-leave --group 群号
  friend-remark --user QQ --remark "备注"
  friend-delete --user QQ [--block true]
  friend-accept --flag FLAG [--approve false]
  group-accept --flag FLAG [--sub-type add] [--approve false] [--reason ""]
  send-message --user QQ --text "文字"
  send-message --group 群号 --text "文字"
  send-image --user QQ --file 图片 [--caption "文字"]
  send-image --group 群号 --file 图片 [--caption "文字"]
  download-image --message-id ID [--out 文件或目录]
  like-user --user QQ [--times 1]
  recall --message-id ID

万能：
  raw <action> --json '{"参数":"值"}'     # 可调用 SnowLuma 任意 OneBot action
  raw <action> --json-file params.json    # PowerShell 下更稳：参数写 UTF-8 文件
`);
}

async function run() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = parseArgs(rest);

  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    usage();
    return;
  }

  switch (cmd) {
    case 'me': {
      const info = await onebot('get_login_info', {});
      let live = null;
      try {
        live = await onebot('get_stranger_info', { user_id: Number(info.user_id) });
      } catch {}
      print({ ...info, ...(live ?? {}), cached: info, live: live ?? null });
      return;
    }
    case 'profile': {
      const params = {};
      if (has(opts, 'nickname')) params.nickname = s(opts, 'nickname', '');
      if (has(opts, 'signature')) params.personal_note = s(opts, 'signature', '');
      if (has(opts, 'note')) params.personal_note = s(opts, 'note', '');
      if (has(opts, 'sex')) params.sex = n(opts, 'sex', 0);
      if (!Object.keys(params).length) throw new Error('至少给一个 --nickname / --signature / --sex');
      print(await onebot('set_qq_profile', params));
      return;
    }
    case 'avatar': {
      if (!has(opts, 'file')) throw new Error('缺少 --file 图片路径');
      print(await onebot('set_qq_avatar', { file: imageSource(opts.file) }));
      return;
    }
    case 'online': {
      const params = { status: n(opts, 'status', 10), ext_status: n(opts, 'ext-status', 0), battery_status: n(opts, 'battery', 100) };
      print(await onebot('set_online_status', params));
      return;
    }
    case 'qzone-post': {
      const content = s(opts, 'content', '');
      if (!content) throw new Error('缺少 --content');
      const params = { content, ugc_right: n(opts, 'right', 4) };
      const images = imageList(opts.images);
      if (images?.length) params.images = images;
      const uins = numberList(opts.uins);
      if (uins?.length) params.target_uins = uins;
      print(await onebot('send_qzone_msg', params));
      return;
    }
    case 'qzone-list': {
      const params = { pos: n(opts, 'pos', 0), num: n(opts, 'num', 20) };
      if (has(opts, 'uin')) params.target_uin = n(opts, 'uin', 0);
      print(await onebot('get_qzone_msg_list', params));
      return;
    }
    case 'qzone-feeds': {
      print(await onebot('get_qzone_feeds', { page_num: n(opts, 'page', 1), count: n(opts, 'count', 20) }));
      return;
    }
    case 'qzone-delete': {
      if (!has(opts, 'tid')) throw new Error('缺少 --tid');
      print(await onebot('delete_qzone_msg', { tid: String(opts.tid) }));
      return;
    }
    case 'qzone-right': {
      if (!has(opts, 'tid')) throw new Error('缺少 --tid');
      const params = { tid: String(opts.tid), ugc_right: n(opts, 'right', 4) };
      const uins = numberList(opts.uins);
      if (uins?.length) params.target_uins = uins;
      print(await onebot('set_qzone_msg_right', params));
      return;
    }
    case 'qzone-like':
    case 'qzone-unlike': {
      if (!has(opts, 'tid')) throw new Error('缺少 --tid');
      const params = { tid: String(opts.tid) };
      if (has(opts, 'uin')) params.target_uin = n(opts, 'uin', 0);
      if (has(opts, 'abstime')) params.abstime = n(opts, 'abstime', 0);
      print(await onebot(cmd === 'qzone-like' ? 'like_qzone' : 'unlike_qzone', params));
      return;
    }
    case 'qzone-comment': {
      if (!has(opts, 'tid')) throw new Error('缺少 --tid');
      const content = s(opts, 'content', '');
      if (!content) throw new Error('缺少 --content');
      const params = { tid: String(opts.tid), content };
      if (has(opts, 'uin')) params.target_uin = n(opts, 'uin', 0);
      const images = imageList(opts.images);
      if (images?.length) params.images = images;
      print(await onebot('comment_qzone', params));
      return;
    }
    case 'qzone-ban': {
      if (!has(opts, 'uin')) throw new Error('缺少 --uin');
      print(await onebot('set_qzone_ban', { user_id: n(opts, 'uin', 0), enable: b(opts, 'off', false) ? false : true }));
      return;
    }
    case 'send-image': {
      if (!has(opts, 'file')) throw new Error('缺少 --file 图片路径');
      const file = path.resolve(String(opts.file));
      if (!fs.existsSync(file)) throw new Error(`图片不存在: ${file}`);
      let action;
      const params = {};
      if (has(opts, 'user') && has(opts, 'group')) throw new Error('--user 和 --group 只能二选一');
      if (has(opts, 'user')) {
        action = 'send_private_msg';
        params.user_id = n(opts, 'user', 0);
      } else if (has(opts, 'group')) {
        action = 'send_group_msg';
        params.group_id = n(opts, 'group', 0);
      } else {
        throw new Error('缺少 --user QQ 或 --group 群号');
      }
      const caption = s(opts, 'caption', '');
      const build = (imageUri) => {
        const message = [];
        if (caption) message.push({ type: 'text', data: { text: caption } });
        message.push({ type: 'image', data: { file: imageUri } });
        return message;
      };
      try {
        params.message = build(imageSource(file));
        print(await onebot(action, params));
      } catch (error) {
        console.error(`[qq-admin] file:// 发送失败，改用 base64：${error.message}`);
        params.message = build(`base64://${fs.readFileSync(file).toString('base64')}`);
        print(await onebot(action, params));
      }
      return;
    }
    case 'send-message': {
      const text = s(opts, 'text', '');
      if (!text) throw new Error('缺少 --text 文字');
      if (has(opts, 'user') && has(opts, 'group')) throw new Error('--user 和 --group 只能二选一');
      let action;
      const params = { message: [{ type: 'text', data: { text } }] };
      if (has(opts, 'user')) {
        action = 'send_private_msg';
        params.user_id = n(opts, 'user', 0);
      } else if (has(opts, 'group')) {
        action = 'send_group_msg';
        params.group_id = n(opts, 'group', 0);
      } else {
        throw new Error('缺少 --user QQ 或 --group 群号');
      }
      print(await onebot(action, params));
      return;
    }
    case 'download-image': {
      if (!has(opts, 'message-id')) throw new Error('缺少 --message-id');
      const rawId = String(opts['message-id']);
      const messageId = Number.isFinite(Number(rawId)) ? Number(rawId) : rawId;
      const msg = await onebot('get_msg', { message_id: messageId });
      const segments = Array.isArray(msg?.message) ? msg.message : [];
      const images = segments.filter((seg) => seg?.type === 'image' && seg?.data);
      if (!images.length) throw new Error('这条消息里没有图片');
      const outOpt = s(opts, 'out', '');
      const outIsDir = outOpt && !path.extname(outOpt);
      if (outIsDir) fs.mkdirSync(path.resolve(outOpt), { recursive: true });
      const files = [];
      for (let i = 0; i < images.length; i += 1) {
        const data = images[i].data;
        let buf = null;
        let ext = '.png';
        const fileHint = String(data.file || '');
        if (path.extname(fileHint)) ext = path.extname(fileHint).toLowerCase();
        if (data.url) {
          try {
            const res = await fetch(String(data.url), {
              headers: { 'user-agent': 'Mozilla/5.0' },
              signal: AbortSignal.timeout(60000)
            });
            if (res.ok) buf = Buffer.from(await res.arrayBuffer());
          } catch {}
        }
        if (!buf && data.file) {
          const got = await onebot('get_image', { file: String(data.file) });
          const value = typeof got === 'string' ? got : (got?.file || got?.data);
          if (typeof value === 'string' && value.startsWith('base64://')) {
            buf = Buffer.from(value.slice('base64://'.length), 'base64');
          } else if (typeof value === 'string' && value.startsWith('data:')) {
            buf = Buffer.from(value.split(',')[1] || '', 'base64');
          } else if (typeof value === 'string' && fs.existsSync(path.resolve(value))) {
            buf = fs.readFileSync(path.resolve(value));
          }
        }
        if (!buf) throw new Error('图片下载失败：没有 url，get_image 也没有返回可用数据');
        if (!path.extname(fileHint)) {
          try { ext = path.extname(new URL(String(data.url)).pathname) || '.png'; } catch {}
        }
        let target;
        if (outIsDir) target = path.join(path.resolve(outOpt), `qq-${messageId}${images.length > 1 ? `-${i + 1}` : ''}${ext}`);
        else if (outOpt) target = path.resolve(outOpt);
        else target = path.join('D:\\Temp\\qq-bridge\\state\\images', `qq-${messageId}${images.length > 1 ? `-${i + 1}` : ''}${ext}`);
        if (images.length > 1 && outOpt && !outIsDir) {
          const base = path.basename(target, path.extname(target));
          target = path.join(path.dirname(target), `${base}-${i + 1}${path.extname(target)}`);
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, buf);
        files.push({ path: target, bytes: buf.length, url: data.url || null, file: data.file || null });
      }
      print({ ok: true, count: files.length, files });
      return;
    }
    case 'friends':
      print(await onebot('get_friend_list', {}));
      return;
    case 'groups':
      print(await onebot('get_group_list', {}));
      return;
    case 'group-members':
      if (!has(opts, 'group')) throw new Error('缺少 --group');
      print(await onebot('get_group_member_list', { group_id: n(opts, 'group', 0) }));
      return;
    case 'group-kick':
      print(await onebot('set_group_kick', {
        group_id: n(opts, 'group', 0),
        user_id: n(opts, 'user', 0),
        reject_add_request: b(opts, 'reject-add', false)
      }));
      return;
    case 'group-ban':
      print(await onebot('set_group_ban', {
        group_id: n(opts, 'group', 0),
        user_id: n(opts, 'user', 0),
        duration: n(opts, 'duration', 1800)
      }));
      return;
    case 'group-whole-ban':
      print(await onebot('set_group_whole_ban', {
        group_id: n(opts, 'group', 0),
        enable: b(opts, 'enable', true)
      }));
      return;
    case 'group-card':
      print(await onebot('set_group_card', {
        group_id: n(opts, 'group', 0),
        user_id: n(opts, 'user', 0),
        card: s(opts, 'card', '')
      }));
      return;
    case 'group-name':
      print(await onebot('set_group_name', {
        group_id: n(opts, 'group', 0),
        group_name: s(opts, 'name', '')
      }));
      return;
    case 'group-avatar':
      if (!has(opts, 'file')) throw new Error('缺少 --file 图片路径');
      print(await onebot('set_group_portrait', {
        group_id: n(opts, 'group', 0),
        file: imageSource(opts.file)
      }));
      return;
    case 'group-admin':
      print(await onebot('set_group_admin', {
        group_id: n(opts, 'group', 0),
        user_id: n(opts, 'user', 0),
        enable: b(opts, 'enable', true)
      }));
      return;
    case 'group-leave':
      print(await onebot('set_group_leave', { group_id: n(opts, 'group', 0) }));
      return;
    case 'friend-remark':
      print(await onebot('set_friend_remark', {
        user_id: n(opts, 'user', 0),
        remark: s(opts, 'remark', '')
      }));
      return;
    case 'friend-delete':
      print(await onebot('delete_friend', {
        user_id: n(opts, 'user', 0),
        block: b(opts, 'block', false)
      }));
      return;
    case 'friend-accept':
      if (!has(opts, 'flag')) throw new Error('缺少 --flag');
      print(await onebot('set_friend_add_request', {
        flag: String(opts.flag),
        approve: b(opts, 'approve', true)
      }));
      return;
    case 'group-accept':
      if (!has(opts, 'flag')) throw new Error('缺少 --flag');
      print(await onebot('set_group_add_request', {
        flag: String(opts.flag),
        sub_type: s(opts, 'sub-type', 'add'),
        approve: b(opts, 'approve', true),
        reason: s(opts, 'reason', '')
      }));
      return;
    case 'like-user':
      print(await onebot('send_like', {
        user_id: n(opts, 'user', 0),
        times: n(opts, 'times', 1)
      }));
      return;
    case 'recall': {
      if (!has(opts, 'message-id')) throw new Error('缺少 --message-id');
      const raw = String(opts['message-id']);
      const messageId = Number.isFinite(Number(raw)) ? Number(raw) : raw;
      print(await onebot('delete_msg', { message_id: messageId }));
      return;
    }
    case 'raw': {
      const action = opts._[0];
      if (!action) throw new Error('用法: raw <action> --json \'{...}\'');
      let params = {};
      let raw = null;
      if (has(opts, 'json-file')) {
        const file = path.resolve(String(opts['json-file']));
        raw = fs.readFileSync(file, 'utf8');
        if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
      } else if (has(opts, 'json')) {
        raw = String(opts.json);
      }
      if (raw !== null) {
        try {
          params = JSON.parse(raw);
        } catch (error) {
          throw new Error(`JSON 不是合法格式: ${error.message}`);
        }
      }
      print(await onebot(action, params));
      return;
    }
    default:
      throw new Error(`未知命令: ${cmd}（运行 node qq-admin.mjs help）`);
  }
}

run().catch((error) => {
  console.error(`[qq-admin] ${error.message}`);
  if (error.payload) console.error(JSON.stringify(error.payload, null, 2));
  process.exitCode = 1;
});
