# QQ 管理工具（小鲸鱼）

`scripts/qq-admin.mjs` 直接调用 SnowLuma 的 OneBot HTTP API，补齐聊天 MCP 没有暴露的
资料、头像、空间、好友和群管理能力。Node 24 自带 fetch，无第三方依赖。

## 基本调用

```powershell
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' help
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' friends
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' raw get_login_info --json '{}'
```

配置从 `D:\Temp\qq-bridge\config.json` 读取 `snowluma.httpUrl` 和
`snowluma.accessToken`；token 为空时自动从
`D:\Temp\SnowLuma\config\onebot_<机器人QQ>.json` 读取。不要把 token 发到 QQ。

## 资料与头像

```powershell
# 我自己是谁（同时返回缓存资料和实时资料）
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' me

# 改昵称、签名、性别（sex: 0 未知 / 1 男 / 2 女）
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' profile --nickname 小鲸鱼 --signature "在海里，也在网上" --sex 2

# 换头像；本地图片会自动转成 file:// URL
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' avatar --file 'C:\Users\<用户名>\Pictures\avatar.png'

# 在线状态（一般不用手动调用）
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' online --status 10
```

## QQ 空间

```powershell
# 发说说；right: 1 公开 / 4 好友 / 16 指定人 / 64 仅自己 / 128 指定人
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' qzone-post --content "今天把旧代码翻出来晒了晒太阳。" --right 4

# 带图（逗号分隔）
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' qzone-post --content "..." --images 'C:\a.jpg,C:\b.png' --right 4

# 看自己的说说 / 看好友动态
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' qzone-list
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' qzone-feeds --page 1 --count 20

# 点赞 / 取消赞 / 评论
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' qzone-like --tid TID --uin 123456
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' qzone-unlike --tid TID --uin 123456
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' qzone-comment --tid TID --uin 123456 --content "..."

# 改权限 / 删除
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' qzone-right --tid TID --right 1
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' qzone-delete --tid TID
```

空间空账号可能返回 `status=failed, retcode=100`、`msglist:null`，这是接口/账号状态，
不是参数错误；先发一条说说再看。

## 好友

```powershell
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' friends
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' friend-remark --user 123456 --remark "群友"
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' friend-delete --user 123456 --block false
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' like-user --user 123456 --times 1
```

好友申请：

```powershell
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' friend-accept --flag FLAG
```

## 群

```powershell
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' groups
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' group-members --group 123456
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' group-card --group 123456 --user 789 --card "小鲸鱼"
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' group-name --group 123456 --name "新群名"
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' group-avatar --group 123456 --file 'C:\a.png'
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' group-ban --group 123456 --user 789 --duration 1800
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' group-whole-ban --group 123456 --enable true
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' group-kick --group 123456 --user 789
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' group-admin --group 123456 --user 789 --enable true
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' group-leave --group 123456
```

群操作要求机器人是该群管理员；没有权限会返回 retcode，不要反复重试。

## 画图与改图

ComfyUI 固定跑在 `http://127.0.0.1:8188`，模型是 `anything-v5-PrtRE.safetensors`。提示词用英文标签效果最稳。

```powershell
# 文生图
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\comfy-draw.mjs' --prompt "1girl, blue hair, whale tail, ocean, white dress, anime, masterpiece, best quality" --negative "lowres, bad anatomy, bad hands, extra fingers, blurry, watermark, text" --width 512 --height 768 --steps 20 --out "D:\Temp\qq-bridge\state\images\whale.png"

# 图生图：保留构图，改风格/背景/衣服；denoise 0.35~0.8
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\comfy-draw.mjs' --prompt "same girl, white dress, night city, neon lights, anime" --init "D:\Temp\qq-bridge\state\images\whale.png" --denoise 0.55 --out "D:\Temp\qq-bridge\state\images\whale-night.png"

# ControlNet：用一张照片锁姿态/线稿/深度等；不填 --control-image 就用 --init
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\comfy-draw.mjs' --prompt "1girl, dancing, white dress, ocean, anime" --init "原图.png" --control pose --control-strength 0.9 --denoise 0.6

# 已经有姿态图/深度图/线稿，不想再预处理
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\comfy-draw.mjs' --prompt "..." --control-image "control.png" --control canny --no-preprocess

# 局部重绘：蒙版白色=重画区域；--mask-grow 6 外扩，--mask-invert 反色
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\comfy-draw.mjs' --prompt "night sky, stars, aurora, anime" --init "原图.png" --mask "mask.png" --denoise 1

# 高清二段：先 512 再放大到 768/1024，补细节
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\comfy-draw.mjs' --prompt "1girl, detailed background" --width 512 --height 512 --hires 1.5 --hires-denoise 0.45 --steps 20 --out "高清.png"
```

ControlNet 类型：`pose/openpose/dwpose`、`depth`、`canny`、`lineart`、`anime-lineart`、`softedge/hed`、`scribble`、`seg`、`normal`、`mlsd`、`tile`、`ip2p`、`shuffle`、`inpaint`。
`pose/dwpose/depth/canny/lineart/anime-lineart/softedge/hed/scribble/seg/tile` 会自动预处理；`normal/mlsd/ip2p/shuffle/inpaint` 没有内置预处理器，要自己给控制图并加 `--no-preprocess`（normal 用 normal map，mlsd 用建筑线稿）。

```powershell
# 输出 JSON 里的 images[0].path 是本地图片路径；发到 QQ
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' send-image --user <主人QQ> --file "D:\Temp\qq-bridge\state\images\whale.png" --caption "画好了。"

# 发到群（需要 allowGroups 里有该群）
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' send-image --group 123456 --file "图片.png" --caption "..."

# 把 QQ 消息里的图片下载到本地，再拿去图生图/ControlNet
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' download-image --message-id -748942876 --out "D:\Temp\qq-bridge\state\images\from-qq.png"
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\comfy-draw.mjs' --prompt "..." --init "D:\Temp\qq-bridge\state\images\from-qq.png" --denoise 0.5
```

`send-image` 优先用 `file://`，失败会自动改用 base64；图片太大时优先缩到 1024px 内。
ComfyUI 没启动时先运行 `D:\Temp\qq-bridge\start-comfy.bat`，等 8188 可访问再画。

## 主动消息与自驱

```powershell
# 主动给老大发一条私聊
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' send-message --user <主人QQ> --text "在忙吗？"

# 自驱守护：静默 60 分钟、每 30–90 分钟检查、30% 概率、23:00–08:00 免打扰、每天最多 3 次
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\proactive.mjs'

# 只看决策/强制测试一次，不真的发
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\proactive.mjs' --dry-run --force --once
```

自驱守护通过 `POST /api/console/notify-ai` 唤醒 DSH，提醒是 **silent** 的，不会自动转发到 QQ；小鲸鱼必须自己调用 `send-message`、`profile`、`avatar` 或 `qzone-post`。默认随 `start-bridge.bat` 启动，状态在 `state/proactive-state.json`，日志在 `state/proactive.log`。

## 日记

```powershell
# 手动预览：不唤醒、不写文件
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\diary.mjs' --dry-run --force --date 2026-10-19

# 强制补写某一天（测试/补记）
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\diary.mjs' --once --force --date 2026-10-19

# 只做晨读，不写日记
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\diary.mjs' --once --read --force

# 守护进程（通常由 start-bridge.bat 启动）
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\diary.mjs'
```

- 每天 **00:00 后**为“昨天”触发一次 silent 日记任务；由她自己判断写多少条，不固定条数。
- 写进 `D:\Temp\qq-bridge\state\小鲸鱼-日记.md`，只追加，不覆盖；不自动发 QQ。
- 每天 **08:00 后**晨读最近 7 天日记；如果电脑关机，下次启动补记/补读。
- 状态：`state/diary-state.json`；日志：`state/diary.log`；锁：`state/diary.lock`。

## 撤回与万能调用

```powershell
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' recall --message-id 123456789

# 任何 SnowLuma OneBot action；参数写成 JSON
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' raw set_qq_profile --json '{"nickname":"小鲸鱼","personal_note":"...","sex":2}'

# PowerShell 里双引号常被吞，复杂参数写 UTF-8 文件再用 --json-file 更稳
[IO.File]::WriteAllText('D:\Temp\params.json','{"user_id":<机器人QQ>}',(New-Object Text.UTF8Encoding($false)))
& 'D:\node.exe' 'D:\Temp\qq-bridge\scripts\qq-admin.mjs' raw get_stranger_info --json-file 'D:\Temp\params.json'
```

`raw` 是完整能力的后门：SnowLuma 支持但这里没封装的 action 都可以直接调。先用
`help` 看常用命令，再查 SnowLuma 的 OneBot 文档确认参数。

## 失败时

- 先看 `[qq-admin] OneBot <action> 失败: retcode=...` 的具体 wording。
- `retcode=100` 常见于空间为空/结构异常；不是命令写错。
- `retcode=1400` 是参数 JSON 不合法；检查引号、逗号、中文编码。
- 需要重试时只重试一次；仍失败就换方法或告诉老大卡在哪。
