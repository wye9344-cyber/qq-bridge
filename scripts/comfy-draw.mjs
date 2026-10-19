#!/usr/bin/env node
// comfy-draw.mjs — 用本机 ComfyUI 画图/改图，供小鲸鱼在 QQ 里直接调用。
//
// 依赖：ComfyUI 在 127.0.0.1:8188 运行，checkpoint 为 anything-v5。
// 只用 Node 原生 fetch/FormData，无第三方依赖。
//
// 模式：
//   文生图     node comfy-draw.mjs --prompt "1girl, blue hair, ..."
//   图生图     node comfy-draw.mjs --prompt "..." --init 原图.png --denoise 0.55
//   局部重绘   node comfy-draw.mjs --prompt "..." --init 原图.png --mask 黑白蒙版.png
//   ControlNet node comfy-draw.mjs --prompt "..." --init 原图.png --control pose
//              （默认自动预处理；已有姿态/深度/边缘图时加 --no-preprocess）
//   高清二段   node comfy-draw.mjs --prompt "..." --hires 1.5
//
// stdout 输出 JSON：{ok, prompt_id, mode, seed, images:[{path,...}], elapsed_ms}

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const API = (process.env.COMFY_URL || 'http://127.0.0.1:8188').replace(/\/+$/, '');
const DEFAULT_MODEL = 'anything-v5-PrtRE.safetensors';
const DEFAULT_NEGATIVE = 'lowres, bad anatomy, bad hands, extra fingers, blurry, worst quality, low quality, watermark, text, signature, username';

// 14 个 SD1.5 ControlNet；文件名与 models/controlnet 下实际文件一致。
const CONTROL_TYPES = {
  pose:         { model: 'control_v11p_sd15_openpose_fp16.safetensors',        pre: 'OpenposePreprocessor' },
  openpose:     { model: 'control_v11p_sd15_openpose_fp16.safetensors',        pre: 'OpenposePreprocessor' },
  dwpose:       { model: 'control_v11p_sd15_openpose_fp16.safetensors',        pre: 'DWPreprocessor' },
  depth:        { model: 'control_v11f1p_sd15_depth_fp16.safetensors',         pre: 'DepthAnythingPreprocessor' },
  canny:        { model: 'control_v11p_sd15_canny_fp16.safetensors',           pre: 'CannyEdgePreprocessor' },
  lineart:      { model: 'control_v11p_sd15_lineart_fp16.safetensors',         pre: 'LineArtPreprocessor' },
  'anime-lineart': { model: 'control_v11p_sd15s2_lineart_anime_fp16.safetensors', pre: 'AnimeLineArtPreprocessor' },
  softedge:     { model: 'control_v11p_sd15_softedge_fp16.safetensors',        pre: 'HEDPreprocessor' },
  hed:          { model: 'control_v11p_sd15_softedge_fp16.safetensors',        pre: 'HEDPreprocessor' },
  scribble:     { model: 'control_v11p_sd15_scribble_fp16.safetensors',        pre: 'ScribblePreprocessor' },
  seg:          { model: 'control_v11p_sd15_seg_fp16.safetensors',             pre: 'SemSegPreprocessor' },
  normal:       { model: 'control_v11p_sd15_normalbae_fp16.safetensors',       pre: null },
  mlsd:         { model: 'control_v11p_sd15_mlsd_fp16.safetensors',            pre: null },
  tile:         { model: 'control_v11f1e_sd15_tile_fp16.safetensors',          pre: 'TilePreprocessor' },
  ip2p:         { model: 'control_v11e_sd15_ip2p_fp16.safetensors',            pre: null },
  shuffle:      { model: 'control_v11e_sd15_shuffle_fp16.safetensors',         pre: null },
  inpaint:      { model: 'control_v11p_sd15_inpaint_fp16.safetensors',         pre: null }
};

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
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const str = (o, k, d) => (has(o, k) && o[k] !== true ? String(o[k]) : d);
const num = (o, k, d) => {
  if (!has(o, k)) return d;
  const v = Number(o[k]);
  if (!Number.isFinite(v)) throw new Error(`--${k} 必须是数字: ${o[k]}`);
  return v;
};
const bool = (o, k, d = false) => {
  if (!has(o, k)) return d;
  const v = o[k];
  if (v === true) return true;
  if (v === false) return false;
  return !['false', '0', 'no', 'off', 'disable'].includes(String(v).toLowerCase());
};
const readTextFile = (file) => {
  let text = fs.readFileSync(path.resolve(String(file)), 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.trim();
};
const round8 = (n) => Math.max(8, Math.round(n / 8) * 8);

function absOut(value) {
  if (!value) return path.join('D:\\Temp\\qq-bridge\\state\\images', `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`);
  const p = path.resolve(String(value));
  const ext = path.extname(p).toLowerCase();
  if (ext === '.png') return p;
  if (ext) return `${p.slice(0, -ext.length)}.png`;
  return path.join(p, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`ComfyUI 返回非 JSON（HTTP ${res.status}）: ${text.slice(0, 500)}`);
  }
  if (!res.ok) {
    const detail = data?.node_errors ? ` node_errors=${JSON.stringify(data.node_errors).slice(0, 1500)}` : '';
    throw new Error(`ComfyUI /prompt 失败 HTTP ${res.status}: ${JSON.stringify(data).slice(0, 1500)}${detail}`);
  }
  return data;
}

const nodeExistsCache = new Map();
async function nodeExists(api, name) {
  const key = `${api}|${name}`;
  if (nodeExistsCache.has(key)) return nodeExistsCache.get(key);
  let ok = false;
  try {
    const res = await fetch(`${api}/object_info/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const data = await res.json();
      ok = Boolean(data && typeof data === 'object' && data[name]);
    }
  } catch {
    ok = false;
  }
  nodeExistsCache.set(key, ok);
  return ok;
}

async function uploadImage(api, file, cache) {
  const p = path.resolve(String(file));
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) throw new Error(`图片不存在: ${p}`);
  if (cache.has(p)) return cache.get(p);
  const buf = fs.readFileSync(p);
  const form = new FormData();
  form.append('image', new Blob([buf], { type: 'application/octet-stream' }), path.basename(p));
  form.append('type', 'input');
  form.append('overwrite', 'true');
  const res = await fetch(`${api}/upload/image`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(120000)
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`上传图片失败 HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  if (!res.ok || !data?.name) throw new Error(`上传图片失败 HTTP ${res.status}: ${JSON.stringify(data).slice(0, 800)}`);
  const name = data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
  cache.set(p, name);
  return name;
}

function preParams(type, resolution) {
  switch (type) {
    case 'pose':
    case 'openpose':
    case 'dwpose':
      return { detect_hand: 'enable', detect_body: 'enable', detect_face: 'enable', resolution };
    case 'canny':
      return { low_threshold: 100, high_threshold: 200, resolution };
    case 'depth':
      return { ckpt_name: 'depth_anything_vits14.pth', resolution };
    case 'lineart':
      return { coarse: 'disable', resolution };
    case 'anime-lineart':
    case 'scribble':
    case 'seg':
      return { resolution };
    case 'softedge':
    case 'hed':
      return { safe: 'enable', resolution };
    case 'tile':
      return { pyrUp_iters: 3, resolution };
    default:
      return {};
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || opts.h || (!has(opts, 'prompt') && !has(opts, 'prompt-file'))) {
    console.log(`comfy-draw.mjs — 用本机 ComfyUI 画图/改图

必填：
  --prompt "英文标签提示词"   或   --prompt-file 文件.txt

模式：
  --init 原图.png             图生图；配 --denoise 0.35~0.8
  --mask 黑白蒙版.png          局部重绘；白色=重画区域，需同时 --init
  --control 类型               ControlNet；类型见下
  --control-image 图.png      控制图；不填则用 --init 图
  --no-preprocess             控制图已经是姿态/深度/边缘图，不再预处理
  --hires 1.5                 潜空间高清二段（1.0~2.5）

可选：
  --negative "负面提示词"
  --width 512 --height 768    默认 512x768，须为 8 的倍数
  --steps 20 --cfg 7
  --denoise 0.55              图生图重绘幅度；默认文生图 1、图生图 0.55、局部重绘 1
  --seed 12345                默认随机；-1 也是随机
  --sampler euler --scheduler normal
  --model anything-v5-PrtRE.safetensors
  --batch 1                   一次出几张，默认 1
  --out D:\\path\\a.png      输出文件或目录；默认 state/images/
  --timeout 300               等待秒数
  --api http://127.0.0.1:8188 临时覆盖 ComfyUI 地址

ControlNet 类型：
  pose/openpose/dwpose  depth  canny  lineart  anime-lineart
  softedge/hed  scribble  seg  normal  mlsd  tile  ip2p  shuffle  inpaint
  （normal/mlsd/ip2p/shuffle/inpaint 无内置预处理器，需 --control-image + --no-preprocess）

其他：
  --control-model 文件名       手动指定 controlnet 文件
  --control-strength 1.0       ControlNet 强度
  --control-start 0 --control-end 1
  --preprocess-resolution 512  预处理器分辨率
  --mask-invert                蒙版黑白反过来
  --mask-grow 6                蒙版外扩像素
  --hires-denoise 0.5          高清二段重绘幅度
  --hires-steps 20             高清二段步数，默认同 --steps

示例：
  node comfy-draw.mjs --prompt "1girl, blue hair, whale tail, ocean, anime" --out D:\\Temp\\test.png
  node comfy-draw.mjs --prompt "same girl, white dress, sunset beach" --init D:\\Temp\\a.png --denoise 0.5
  node comfy-draw.mjs --prompt "1girl, dancing" --init D:\\Temp\\a.png --control pose --control-strength 0.9
  node comfy-draw.mjs --prompt "1girl, detailed" --init D:\\Temp\\a.png --hires 1.5
`);
    return;
  }

  const prompt = has(opts, 'prompt-file') ? readTextFile(opts['prompt-file']) : str(opts, 'prompt', '');
  if (!prompt) throw new Error('--prompt 为空');

  const negative = has(opts, 'negative') ? str(opts, 'negative', '') : DEFAULT_NEGATIVE;
  const width = num(opts, 'width', 512);
  const height = num(opts, 'height', 768);
  const steps = num(opts, 'steps', 20);
  const cfg = num(opts, 'cfg', 7);
  const batch = num(opts, 'batch', 1);
  const seed = num(opts, 'seed', -1) < 0 ? crypto.randomInt(0, 2 ** 32) : num(opts, 'seed', 0);
  const sampler = str(opts, 'sampler', 'euler');
  const scheduler = str(opts, 'scheduler', 'normal');
  const model = str(opts, 'model', DEFAULT_MODEL);
  const timeoutMs = Math.max(30, num(opts, 'timeout', 300)) * 1000;
  const api = (has(opts, 'api') ? str(opts, 'api', API) : API).replace(/\/+$/, '');

  if (width <= 0 || height <= 0 || width % 8 !== 0 || height % 8 !== 0) throw new Error('--width/--height 必须是 8 的正整数倍');
  if (!Number.isInteger(steps) || steps < 1 || steps > 100) throw new Error('--steps 必须是 1~100 的整数');
  if (!Number.isInteger(batch) || batch < 1 || batch > 4) throw new Error('--batch 必须是 1~4 的整数');
  if (cfg < 0 || cfg > 30) throw new Error('--cfg 必须在 0~30');

  const initFile = has(opts, 'init') ? str(opts, 'init', '') : '';
  const maskFile = has(opts, 'mask') ? str(opts, 'mask', '') : '';
  const controlRaw = has(opts, 'control') ? str(opts, 'control', '') : (has(opts, 'control-type') ? str(opts, 'control-type', '') : '');
  let controlType = controlRaw.toLowerCase();
  if (controlType === 'none' || controlType === 'off') controlType = '';
  if (controlType && !CONTROL_TYPES[controlType]) {
    throw new Error(`未知 ControlNet 类型: ${controlType}；可用: ${Object.keys(CONTROL_TYPES).join(', ')}`);
  }
  if (!initFile && maskFile) throw new Error('--mask 需要同时提供 --init 原图');
  if (controlType && !initFile && !has(opts, 'control-image')) throw new Error('--control 需要 --control-image 或 --init');

  const mode = maskFile ? 'inpaint' : initFile ? 'img2img' : 'text2img';
  const defaultDenoise = mode === 'img2img' ? 0.55 : 1;
  const denoise = num(opts, 'denoise', defaultDenoise);
  if (denoise < 0 || denoise > 1) throw new Error('--denoise 必须在 0~1');
  const hiresScale = num(opts, 'hires', 0);
  if (hiresScale && (hiresScale < 1 || hiresScale > 2.5)) throw new Error('--hires 必须在 1.0~2.5');
  const hiresDenoise = num(opts, 'hires-denoise', 0.5);
  const hiresSteps = num(opts, 'hires-steps', steps);
  if (hiresDenoise < 0 || hiresDenoise > 1) throw new Error('--hires-denoise 必须在 0~1');
  const preRes = num(opts, 'preprocess-resolution', 512);
  const controlStrength = num(opts, 'control-strength', 1);
  const controlStart = num(opts, 'control-start', 0);
  const controlEnd = num(opts, 'control-end', 1);
  const growMaskBy = num(opts, 'mask-grow', 6);
  const invertMask = bool(opts, 'mask-invert', false);
  const preprocess = controlType ? !bool(opts, 'no-preprocess', false) : false;
  const uploads = new Map();
  const warnings = [];

  if (hiresScale && mode === 'inpaint') {
    warnings.push('局部重绘模式忽略 --hires');
  }

  const prefix = `xiaojingyu/${mode}-${Date.now()}-${seed}${controlType ? `-${controlType}` : ''}`;
  const graph = {};
  let seq = 0;
  const add = (class_type, inputs) => {
    const id = String(++seq);
    graph[id] = { class_type, inputs };
    return id;
  };

  const ckpt = add('CheckpointLoaderSimple', { ckpt_name: model });
  const pos = add('CLIPTextEncode', { text: prompt, clip: [ckpt, 1] });
  const neg = add('CLIPTextEncode', { text: negative, clip: [ckpt, 1] });

  let initNode = null;
  let latent = null;

  if (initFile) {
    const name = await uploadImage(api, initFile, uploads);
    initNode = add('LoadImage', { image: name });
    if (maskFile) {
      const maskName = await uploadImage(api, maskFile, uploads);
      const maskLoad = add('LoadImage', { image: maskName });
      let maskNode = add('ImageToMask', { image: [maskLoad, 0], channel: 'red' });
      if (invertMask) maskNode = add('InvertMask', { mask: [maskNode, 0] });
      latent = add('VAEEncodeForInpaint', {
        pixels: [initNode, 0],
        vae: [ckpt, 2],
        mask: [maskNode, 0],
        grow_mask_by: growMaskBy
      });
    } else {
      latent = add('VAEEncode', { pixels: [initNode, 0], vae: [ckpt, 2] });
    }
  } else {
    latent = add('EmptyLatentImage', { width, height, batch_size: batch });
  }

  let posCond = [pos, 0];
  let negCond = [neg, 0];
  let controlInfo = null;

  if (controlType) {
    const cnConf = CONTROL_TYPES[controlType];
    let controlImageNode = initNode;
    if (has(opts, 'control-image') && opts['control-image'] !== true) {
      const name = await uploadImage(api, str(opts, 'control-image', ''), uploads);
      controlImageNode = add('LoadImage', { image: name });
    }
    if (!controlImageNode) throw new Error('ControlNet 没有控制图');

    let controlImageOut = [controlImageNode, 0];
    let preNode = null;
    if (preprocess && cnConf.pre) {
      const available = await nodeExists(api, cnConf.pre);
      if (!available) {
        throw new Error(`缺少预处理器 ${cnConf.pre}；请用 --no-preprocess 直接提供控制图，或安装 comfyui_controlnet_aux 依赖`);
      }
      preNode = add(cnConf.pre, { image: [controlImageNode, 0], ...preParams(controlType, preRes) });
      controlImageOut = [preNode, 0];
    } else if (!preprocess) {
      controlImageOut = [controlImageNode, 0];
    }

    const cnModel = has(opts, 'control-model') ? str(opts, 'control-model', cnConf.model) : cnConf.model;
    const cnLoader = add('ControlNetLoader', { control_net_name: cnModel });
    const apply = add('ControlNetApplyAdvanced', {
      positive: posCond,
      negative: negCond,
      control_net: [cnLoader, 0],
      image: controlImageOut,
      strength: controlStrength,
      start_percent: controlStart,
      end_percent: controlEnd
    });
    posCond = [apply, 0];
    negCond = [apply, 1];
    controlInfo = {
      type: controlType,
      model: cnModel,
      preprocessor: preprocess && cnConf.pre ? cnConf.pre : null,
      strength: controlStrength,
      start: controlStart,
      end: controlEnd
    };
  }

  let samplerNode = add('KSampler', {
    seed,
    steps,
    cfg,
    sampler_name: sampler,
    scheduler,
    denoise,
    model: [ckpt, 0],
    positive: posCond,
    negative: negCond,
    latent_image: [latent, 0]
  });
  let outLatent = [samplerNode, 0];
  let hiresInfo = null;

  if (hiresScale >= 1 && mode !== 'inpaint') {
    const up = add('LatentUpscale', {
      samples: [samplerNode, 0],
      upscale_method: 'bicubic',
      width: round8(width * hiresScale),
      height: round8(height * hiresScale),
      crop: 'disabled'
    });
    const sampler2 = add('KSampler', {
      seed: (seed + 1) >>> 0,
      steps: Math.max(1, Math.round(hiresSteps)),
      cfg,
      sampler_name: sampler,
      scheduler,
      denoise: hiresDenoise,
      model: [ckpt, 0],
      positive: posCond,
      negative: negCond,
      latent_image: [up, 0]
    });
    outLatent = [sampler2, 0];
    hiresInfo = { scale: hiresScale, denoise: hiresDenoise, steps: Math.max(1, Math.round(hiresSteps)) };
  }

  const decode = add('VAEDecode', { samples: outLatent, vae: [ckpt, 2] });
  add('SaveImage', { filename_prefix: prefix, images: [decode, 0] });

  const clientId = crypto.randomUUID();
  const started = Date.now();
  const queued = await postJson(`${api}/prompt`, { prompt: graph, client_id: clientId });
  const promptId = queued?.prompt_id;
  if (!promptId) throw new Error(`ComfyUI 没有返回 prompt_id: ${JSON.stringify(queued).slice(0, 500)}`);
  console.error(`[comfy-draw] queued ${promptId} (${mode}${controlType ? ` + ${controlType}` : ''}, ${width}x${height}, steps=${steps}, denoise=${denoise}, seed=${seed})`);

  let history = null;
  let lastStatus = '';
  while (Date.now() - started < timeoutMs) {
    await sleep(1000);
    const res = await fetch(`${api}/history/${encodeURIComponent(promptId)}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`ComfyUI /history HTTP ${res.status}`);
    const data = await res.json();
    const entry = data?.[promptId];
    if (!entry) continue;
    const status = entry?.status?.status_str || entry?.status?.status || '';
    if (status && status !== lastStatus) {
      lastStatus = status;
      console.error(`[comfy-draw] ${status}`);
    }
    if (entry?.status?.status_str === 'error' || status === 'error') {
      throw new Error(`ComfyUI 执行失败: ${JSON.stringify(entry.status).slice(0, 2500)}`);
    }
    if (entry?.outputs && Object.keys(entry.outputs).length > 0) {
      history = entry;
      break;
    }
  }
  if (!history) throw new Error(`等待 ComfyUI 出图超时（${Math.round(timeoutMs / 1000)} 秒）`);

  const outputs = [];
  for (const node of Object.values(history.outputs || {})) {
    if (!Array.isArray(node?.images)) continue;
    for (const img of node.images) outputs.push(img);
  }
  if (!outputs.length) throw new Error(`ComfyUI 没有返回图片: ${JSON.stringify(history).slice(0, 1200)}`);

  const outPath = absOut(opts.out);
  const outDir = path.dirname(outPath);
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.basename(outPath, path.extname(outPath));
  const saved = [];
  for (let i = 0; i < outputs.length; i += 1) {
    const img = outputs[i];
    const qs = new URLSearchParams({
      filename: img.filename,
      subfolder: img.subfolder || '',
      type: img.type || 'output'
    });
    const res = await fetch(`${api}/view?${qs.toString()}`, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`下载图片失败 HTTP ${res.status}: ${img.filename}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const target = outputs.length === 1 ? outPath : path.join(outDir, `${base}_${i + 1}.png`);
    fs.writeFileSync(target, buf);
    saved.push({ path: target, filename: img.filename, subfolder: img.subfolder || '', bytes: buf.length });
  }

  console.log(JSON.stringify({
    ok: true,
    prompt_id: promptId,
    mode,
    seed,
    width,
    height,
    steps,
    cfg,
    denoise,
    model,
    control: controlInfo,
    hires: hiresInfo,
    warnings,
    elapsed_ms: Date.now() - started,
    images: saved
  }, null, 2));
}

main().catch((error) => {
  console.error(`[comfy-draw] ${error.message}`);
  process.exitCode = 1;
});
