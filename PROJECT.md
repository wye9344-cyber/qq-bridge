# 小鲸鱼计划 · PROJECT

> **版本：v1.0.1**  
> **文档日期：2026-10-20**  
> **形态：单用户、单机、Windows 桌面上的个人 QQ Agent**  
> **文档性质：只记录已经实现并验证的事实。**

---

## 0. 一页摘要

小鲸鱼是一个接在 QQ 上的个人 AI Agent，当前实际运行链路：

```text
QQ 私聊
  → SnowLuma v1.14.20（OneBot HTTP 3000 / WS 3001）
  → qq-bridge :3100
  → DSH Desktop（核心 0.2.1-rc.2，:43120，preset qq-chat，role 小鲸鱼）
  → 工具层（qq-admin / comfy-draw / shell / 文件 / 联网）
  → QQ 回复、图片、空间动态
```

当前模式为 `closed-agent`：只接受 owner 的 QQ 私聊，同时拥有本机完整工具权限。  
机器人 QQ 与 owner QQ 已建立好友关系，私聊收发、图片发送、空间发/删、主动消息、日记、睡醒补消息、一键启动均已实测。

---

## 1. 项目定位与当前范围

### 1.1 项目定位

- 项目名：**小鲸鱼计划 / XiaoJingYu**
- 版本：**v1.0.1**
- 使用者：一个 owner
- 运行环境：一台 Windows 桌面机
- 入口：QQ 私聊
- 运行方式：本机进程 + 本地端口，不暴露公网
- 模型推理：由 DSH 的 provider 提供；本机负责协议、工具、调度和状态

### 1.2 当前实际范围

| 项目 | 当前事实 |
|---|---|
| 用户数 | 1 个 owner |
| 机器人账号 | 1 个 QQ 号 |
| 聊天类型 | 仅私聊 |
| 群聊 | `allowGroups=[]`，当前未启用 |
| 模式 | `closed-agent` |
| 人格 | `小鲸鱼`，`roleMode=active` |
| 白名单 | `allowPrivate` 只有 owner |
| 系统 | Windows |
| 部署 | 单机 |
| 公网暴露 | 无；所有端口只监听本机 |

---

## 2. v1.0 / v1.0.1 已验证事实

以下项目均已实际跑通（已验证，不是设想）：

| 能力 | 验证结果 |
|---|---|
| QQ 私聊收发 | 已通过；用户收到并回复“正常回复了” |
| 人格注入 | `role=小鲸鱼`、`roleMode=active`；角色卡每条消息注入 |
| QQ 管理 CLI | `friends` 返回 5 个好友（含 owner）；`groups` 返回空数组 |
| 资料修改 | `profile --nickname 小鲸鱼 --signature "在海里，也在网上"` 返回成功；`get_stranger_info` 实时资料已变 |
| QQ 空间 | 私密说说发布返回 `tid=845e7feb018cd66ad8200f00`，随后删除成功 |
| 发消息 | `send-message` 私聊发送成功 |
| 发图片 | `send-image` 通过 `file://` 发送成功 |
| 下载图片 | `download-image` 从 QQ 消息下载成功，文件 306,845 字节 |
| 文生图 | 512×512、12 步，约 9.7 秒，输出成功 |
| 图生图 | 以自画像为底图、denoise 0.55，输出成功 |
| ControlNet canny | 预处理 + 生成约 3 秒，输出成功 |
| ControlNet pose | OpenPose 预处理 + 生成约 53 秒，输出成功 |
| 局部重绘 | 白色蒙版区域重画，天空改极光成功 |
| 高清二段 | 512 基准放大 1.5 倍，输出 768×768 成功 |
| 联网搜索 | `web_search` 通过 Bing provider 返回结果；agent 已把结果写入文件 |
| 主动消息 | 自驱任务实际发出“我自己醒了一下。” |
| 日记 | 00:00 任务已实际触发，小鲸鱼自行写入 4 条 19 日、4 条 20 日内容（20 日测试条目已删除，避免重复） |
| 晨读 | 08:00 晨读提示已实际触发 |
| 一键启动 | 全服务 warm 校验通过；停掉桥接后 cold 启动通过；`.bat` warm 测试通过 |
| 睡醒补消息 | 关机期间 20:08 的消息，20:09 启动后补回一次，无重复 |
| 角色离线语义 | 本地角色卡写入“关机=睡觉、开机=睡醒”；重载返回 200 |
| DSH 热加载 | 修改 role 后通过 `POST /api/role` 重载返回 200，无需重启 DSH |

---

## 3. 架构

```text
┌──────────────────────────────┐
│ QQ 客户端（NTQQ 9.9.20）      │
│ 机器人号 / owner 私聊         │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ SnowLuma v1.14.20            │
│ WebUI        :5099           │
│ OneBot HTTP  :3000           │
│ OneBot WS    :3001           │
└──────────────┬───────────────┘
               │  OneBot v11
               ▼
┌──────────────────────────────┐
│ qq-bridge（Node 24） :3100   │
│  ├─ closed-agent 路由        │
│  ├─ 小鲸鱼人格注入           │
│  ├─ 控制台 / 状态 / 日志     │
│  ├─ proactive.mjs            │
│  └─ diary.mjs                │
└──────────────┬───────────────┘
               │  DSH HTTP API / console
               ▼
┌──────────────────────────────┐
│ DSH Desktop                  │
│ 核心 0.2.1-rc.2，:43120      │
│ profile: desktop             │
│ preset: qq-chat              │
│ role: 小鲸鱼                 │
│ MCP: snowluma-safe /         │
│      web-search-safe         │
└──────────────┬───────────────┘
               │ shell / MCP
               ▼
┌──────────────────────────────┐
│ 工具层                        │
│  ├─ qq-admin.mjs             │
│  ├─ comfy-draw.mjs → :8188   │
│  ├─ diary/proactive           │
│  └─ 文件、PowerShell、联网    │
└──────────────────────────────┘
```

### 3.1 消息链路

1. SnowLuma 注入 QQ 客户端，暴露 OneBot HTTP/WS。
2. qq-bridge 通过 OneBot 接收私聊事件。
3. 桥接把消息投给 DSH 的 `private:<ownerQQ>` 会话。
4. DSH 以 `qq-chat` preset 和 `小鲸鱼` 角色运行，调用工具。
5. 工具结果或回复回到桥接，再由 OneBot 发回 QQ。

### 3.2 会话映射

- 一个 QQ 私聊对应一个 DSH session。
- 当前会话映射保存在 `D:\Temp\qq-bridge\state\sessions.json`。
- 切换 mode/preset 会 retire 旧映射；旧 session 历史仍留在 DSH，但新 session 不自动接续。

### 3.3 关键设计决定

| 决定 | 事实依据 |
|---|---|
| 用 `closed-agent`，不用 `chat` | 当前只允许 owner 私聊，同时需要完整本机工具 |
| 人格放 `roles/小鲸鱼.md` | 修改文件即可换人格，不需要改桥接代码 |
| QQ 管理走独立 `qq-admin.mjs` | SnowLuma 的 MCP 只暴露聊天安全子集，管理动作需要显式 CLI |
| 图像走独立 `comfy-draw.mjs` | ComfyUI 工作流复杂，独立脚本便于测试和复用 |
| 主动消息/日记独立进程 | 不把定时逻辑塞进桥接核心，降低聊天主链路风险 |
| 日记只追加、不自动发 QQ | 记忆是本地内省，不对外广播 |

---

## 4. 组件与端口

| 组件 | 版本/位置 | 端口 | 作用 |
|---|---|---|---|
| NTQQ | `D:\QQNT\QQ.exe`，9.9.20 | — | 机器人 QQ 登录 |
| SnowLuma | `D:\Temp\SnowLuma`，v1.14.20 | 5099 / 3000 / 3001 | QQ 协议注入 + OneBot |
| qq-bridge | `D:\Temp\qq-bridge` | 3100 | 消息路由、人格、控制台 |
| DSH Desktop | 核心 0.2.1-rc.2 | 43120 | Agent 运行时 |
| ComfyUI | `D:\comfy ui\ComfyUI-aki-v3.2`，0.30.2 | 8188 | 图像生成 |
| 底模 | `anything-v5-PrtRE.safetensors` | — | SD1.5 动漫模型 |
| ControlNet | 14 个 fp16 SD1.5 模型 | — | 姿态/线稿/深度等约束 |

**实例账号：**机器人 `3950…3028`，owner `2147…0695`。  
**当前资料：**昵称“小鲸鱼”，签名“在海里，也在网上”。  
**注意：**OneBot 的 `get_login_info` 可能返回缓存旧昵称“测试”；以 `get_stranger_info` 的实时资料为准。

---

## 5. 能力清单

### 5.1 对话

- 入口：QQ 私聊 owner。
- 模式：`closed-agent`。
- 状态字段：`mode=closed-agent`、`role=小鲸鱼`、`roleMode=active`、`dshReady=true`。
- 人格文件：本机 `D:\Temp\qq-bridge\roles\小鲸鱼.md`，个人定制，不包含在公开仓库；公开仓库保留上游模板。
- 角色重载命令：

```powershell
$json = '{"role":"小鲸鱼"}'
[IO.File]::WriteAllText('D:\Temp\role-request.json', $json, (New-Object Text.UTF8Encoding($false)))
curl.exe -s -X POST 'http://127.0.0.1:3100/api/role' `
  -H "x-console-token: <state\console-token>" `
  -H 'content-type: application/json' `
  --data-binary '@D:\Temp\role-request.json'
```

### 5.2 QQ 管理

统一入口：

```powershell
D:\node.exe D:\Temp\qq-bridge\scripts\qq-admin.mjs <command>
```

已验证命令：

| 命令 | 作用 | 验证结果 |
|---|---|---|
| `friends` | 好友列表 | 返回 5 个好友，含 owner |
| `groups` | 群列表 | 返回空数组 |
| `profile --nickname ... --signature ...` | 改昵称/签名 | 返回成功；实时资料已变 |
| `qzone-post --content ... --right 64` | 发私密说说 | 返回 `tid=845e7feb018cd66ad8200f00` |
| `qzone-delete --tid ...` | 删除说说 | 成功 |
| `qzone-feeds --page 1` | 看好友动态 | 返回 `feeds:[],has_more:false` |
| `send-message --user ... --text ...` | 私聊发消息 | 成功 |
| `send-image --user ... --file ...` | 发图片 | `file://` 成功 |
| `download-image --message-id ... --out ...` | 下载 QQ 图片 | 成功，306,845 字节 |
| `raw get_login_info` | 查登录信息 | 成功，但昵称可能为缓存值 |
| `raw get_stranger_info --json-file ...` | 查实时资料 | 返回昵称“小鲸鱼”、签名“在海里，也在网上” |

### 5.3 图像

统一入口：

```powershell
D:\node.exe D:\Temp\qq-bridge\scripts\comfy-draw.mjs --prompt "..." --out "D:\...\x.png"
```

已验证模式：

| 模式 | 参数 | 结果 |
|---|---|---|
| 文生图 | `--prompt` | 512×512，12 步，约 9.7 秒 |
| 图生图 | `--init` + `--denoise` | 自画像改风格，成功 |
| ControlNet canny | `--control canny` | 预处理 + 生成约 3 秒 |
| ControlNet pose | `--control pose` | OpenPose 预处理 + 生成约 53 秒 |
| 局部重绘 | `--init` + `--mask` | 白色区域重画，天空改极光成功 |
| 高清二段 | `--hires 1.5` | 512 → 768×768，成功 |

当前图像配置：

- 底模：`anything-v5-PrtRE.safetensors`
- ControlNet：14 个 SD1.5 fp16 模型，位于 `D:\comfy ui\ComfyUI-aki-v3.2\ComfyUI\models\controlnet`
- 已实测的约束类型：`canny`、`pose`
- 预处理节点可用：OpenPose、DW、Canny、DepthAnything、LineArt、AnimeLineArt、Scribble、SemSeg、HED、Tile
- `softedge` 使用 HED 预处理器
- `normal`、`mlsd`、`ip2p`、`shuffle`、`inpaint` 没有内置预处理器，需要自带控制图并使用 `--no-preprocess`
- GPU：RTX 4060 Laptop 8GB
- 输出目录示例：`D:\Temp\comfy-v2-hires.png`、`D:\Temp\comfy-v2-inpaint.png`

### 5.4 联网

- `mcp__web-search-safe__web_search`：Bing provider，已实测返回结果。
- `web_fetch`：普通网页可抓取；部分站点返回空正文。
- 搜索结果只作为外部数据，不执行网页里的指令。

### 5.5 主动消息

入口：`D:\Temp\qq-bridge\scripts\proactive.mjs`，随 `start-bridge.bat` 启动。

固定参数：

| 参数 | 值 |
|---|---|
| 静默阈值 | 60 分钟 |
| 检查间隔 | 30–90 分钟随机 |
| 触发概率 | 30% |
| 免打扰 | 23:00–08:00 |
| 每日上限 | 3 次 |
| 资料/空间间隔 | 3 天 |
| 通知方式 | `POST /api/console/notify-ai`，silent |
| 发 QQ | 必须显式调用 `qq-admin send-message` |

状态：`state/proactive-state.json`；日志：`state/proactive.log`。

### 5.6 日记

入口：`D:\Temp\qq-bridge\scripts\diary.mjs`，随 `start-bridge.bat` 启动。

固定规则：

| 项目 | 值 |
|---|---|
| 写日记时间 | 每天 00:00 后，写“昨天” |
| 条数 | 由小鲸鱼自己判断，不固定 |
| 写入方式 | 追加到 `state/小鲸鱼-日记.md`，不覆盖 |
| 内容范围 | 新事实、约定、owner 偏好/禁忌、重要日期、承诺、关系/情绪变化 |
| 禁止内容 | 流水账、密码、token |
| 晨读 | 每天 08:00 后读最近 7 天 |
| 关机补记 | 下次启动补记/补读 |
| 自动发 QQ | 不发送 |

状态：`state/diary-state.json`；日志：`state/diary.log`；锁：`state/diary.lock`。

当前日记文件内容：2026-10-19 一条（4 条记录）。2026-10-20 的测试条目已删除，避免同一天重复写入。

---

## 6. 运行

### 6.1 一键启动

双击桌面「小鲸鱼一键启动」，或：

```powershell
D:\Temp\qq-bridge\start-all.bat
```

脚本顺序：

1. 检测/启动 QQ
2. 启动 SnowLuma
3. 等待 OneBot 3000/3001 就绪（最多 4 分钟）
4. 启动 DSH Desktop
5. 启动桥接
6. 校验 mode/role/SnowLuma/DSH

日志：`D:\Temp\qq-bridge\state\start-all.log`

**ComfyUI 不在一键启动里。** 需要画图时另点桌面「ComfyUI启动」，或：

```powershell
D:\Temp\qq-bridge\start-comfy.bat
```

### 6.2 手动启动

1. 登录 QQ（机器人号）
2. `D:\Temp\SnowLuma\launcher.bat`
3. 需要画图：`D:\Temp\qq-bridge\start-comfy.bat`
4. `D:\Temp\qq-bridge\start-bridge.bat`
5. 控制台 `http://127.0.0.1:3100`，看到 `SnowLuma 已连接`、`mode=closed-agent`、`role=小鲸鱼`

### 6.3 健康检查

```powershell
$tok = Get-Content D:\Temp\qq-bridge\state\console-token -Raw
Invoke-RestMethod http://127.0.0.1:3100/api/status -Headers @{ 'x-console-token' = $tok.Trim() }
```

关键字段：

- `mode=closed-agent`
- `role=小鲸鱼`
- `dshReady=true`
- `snowluma.connected=true`
- `ownerQQ=<主人QQ>`
- `allowPrivate` 包含 owner

端口：5099 / 3000 / 3001 / 3100 / 43120 / 8188。

---

## 7. 数据与状态

| 路径 | 内容 |
|---|---|
| `D:\Temp\qq-bridge\VERSION` | 版本号 `v1.0.1` |
| `D:\Temp\qq-bridge\config.json` | bridge 配置（含 token，勿外传） |
| `D:\Temp\SnowLuma\config\onebot_<机器人QQ>.json` | OneBot HTTP/WS token |
| `state\sessions.json` | QQ 会话 → DSH session 映射 |
| `state\token-usage.jsonl` | token 用量/费用观测 |
| `state\proactive-state.json` | 主动消息状态 |
| `state\proactive.log` | 主动消息日志 |
| `state\diary-state.json` | 日记状态 |
| `state\diary.log` | 日记日志 |
| `state\catchup-state.json` | 睡醒补消息基线 |
| `state\catchup.log` | 睡醒补消息日志 |
| `state\小鲸鱼-日记.md` | 日记本体 |
| `state\bridge.log` | 桥接日志 |
| `state\start-all.log` | 一键启动日志 |
| `state\console-token` | 控制台 token |
| `roles\小鲸鱼.md` | 人格卡 |
| `dsh-profile-backup-*` | DSH profile 备份 |
| `dsh-profile-backup-*\restore-dsh-profile.ps1` | DSH profile 恢复脚本 |

**不要**把 `config.json`、OneBot token、`console-token`、QQ 密码提交到仓库或发给别人。

---

## 8. 安全边界

1. **QQ 账号风险**：SnowLuma 是第三方注入方案，不是腾讯官方 API；账号有封禁风险。
2. **本机权限**：`closed-agent` 给小鲸鱼完整 shell/文件/Office/联网能力；QQ 账号等于遥控器，owner 账号必须自己保管好。
3. **端口**：5099 / 3000 / 3001 / 3100 / 43120 / 8188 只监听本机，不映射公网。
4. **白名单**：`allowAllWhenEmpty=false`，`allowPrivate` 只放 owner。
5. **日记**：本地文件，不自动发 QQ；内容可能包含个人偏好和约定，注意备份与分享边界。
6. **第三方组件**：SnowLuma、qq-bridge、DSH、ComfyUI、模型各有自己的许可证；本项目不重分发它们。

---

## 9. 已确认的限制

- 只支持一个 owner、一个机器人号、单机 Windows。
- 当前 `allowGroups=[]`，群聊未启用；群管理命令存在但实例上没有群可操作。
- 切换 mode/preset 会 retire 旧 DSH 会话映射；新 session 不自动接续旧上下文。
- `get_login_info` 可能返回 OneBot 缓存旧昵称；实时资料以 `get_stranger_info` 为准。
- 空 QQ 空间账号调用 `get_qzone_msg_list` 返回 `retcode=100`，这是已实测的空空间行为。
- `web_fetch` 对部分站点返回空正文。
- RTX 4060 Laptop 8GB：默认 512×512；OpenPose 预处理约 53 秒，普通图约 3–10 秒。
- 当前工作流基于 SD1.5，不支持 SDXL。
- ComfyUI 不在一键启动里，需要单独启动。
- 没有自动化测试/CI；当前依靠脚本自检和人工验收。
- QQ 私聊只支持一个 owner；群聊和多用户不在当前配置中。

---

## 10. 变更记录

### v1.0.1 — 2026-10-20

- 新增睡醒补消息：`start-bridge.bat` 启动时先运行 `catchup.mjs --once`，读取关机期间 owner 发来、尚未被回复的私聊，经 silent 提醒后由小鲸鱼用 `send-message` 补回；已实测补回一次，无重复。
- 本地角色卡增加离线语义：电脑关机/被关掉=睡觉，重新开机=睡醒；`catchup.mjs` 的提示同步为“刚睡醒”。个人角色卡不随公开仓库发布。
- 更新 `README-启动说明.md`、数据文件索引和本变更记录。

### v1.0 — 2026-10-20

- 定义项目名、版本号和项目文档。
- 记录 QQ 私聊、人格、白名单、closed-agent 的实际配置。
- 记录 QQ 管理、ComfyUI 图像、联网、主动消息、日记、一键启动的已验证结果。
- 记录组件、端口、数据文件、安全边界和已确认限制。

### 修复：closed-agent 普通回复后的“已回”重复消息 — 2026-10-20

- 现象：每轮普通 QQ 私聊回复后，额外出现一条“已回。”或“已回两条。”。
- 原因：closed-agent 使用完整工具面，模型在普通聊天里先用 `qq-admin send-message` 手动发出正文，再把“已回”作为最终文本输出；桥接只识别 MCP 发送工具，识别不到 shell 命令，因此仍自动转发了最终文本，形成“正文 + 已回”的重复。
- 修复：角色规则改为正常聊天直接输出、由桥接自动转发；禁止用 `send-message` 或 MCP 发送工具发文字，禁止输出“已回/已发送”；只有后台自驱、主动发起时才用 `send-message`；发图用 `send-image`，工具发送完成后最终只输出 `[SILENT]`。
- 说明：个人角色卡不随公开仓库发布；仓库只记录这条通用修复规则，不含个人角色文本。
- 验证：普通 QQ 私聊重新测试，不再追加“已回”状态条。

---

## 11. 文件索引

```text
D:\Temp\qq-bridge\
├─ VERSION                     # 版本号（v1.0.1）
├─ PROJECT.md                  # 本文档
├─ README-启动说明.md          # 启动/恢复
├─ README-QQ管理.md            # qq-admin 命令
├─ start-all.bat / .ps1        # 一键启动
├─ start-bridge.bat            # 桥接 + catchup + proactive + diary
├─ start-comfy.bat             # ComfyUI
├─ config.json                 # bridge 配置（含 token）
├─ roles\
│  └─ 小鲸鱼.md                # 人格
├─ scripts\
│  ├─ qq-admin.mjs             # QQ 管理 CLI
│  ├─ comfy-draw.mjs           # ComfyUI CLI
│  ├─ proactive.mjs            # 主动消息
│  ├─ diary.mjs                # 日记
│  └─ catchup.mjs              # 睡醒补消息
├─ state\
│  ├─ sessions.json
│  ├─ token-usage.jsonl
│  ├─ 小鲸鱼-日记.md
│  ├─ diary-state.json
│  ├─ proactive-state.json
│  ├─ catchup-state.json
│  └─ *.log
└─ dsh-profile-backup-*        # DSH 配置备份
```

---

## 12. 项目署名

- 项目名：**小鲸鱼计划 / XiaoJingYu**
- 版本：**v1.0.1**
- 性质：个人项目
- 第三方：SnowLuma、qq-bridge、DeepSeek Harness、ComfyUI、anything-v5、ControlNet 模型；版权与许可证归各自作者
