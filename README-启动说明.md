# DSH × QQ 桥接启动说明

> 项目版本：**小鲸鱼计划 v1.0**  
> 项目文档：[PROJECT.md](D:/Temp/qq-bridge/PROJECT.md)

## 当前账号
- 机器人 QQ：<机器人QQ>，昵称“小鲸鱼”（SnowLuma 已注入登录）
- 主人/发消息 QQ：<主人QQ>（已加入白名单）
- 模式：closed-agent（仅私聊主人，完整电脑工具）
- 人格：小鲸鱼（`roles/小鲸鱼.md`，已启用）
- 控制台：http://127.0.0.1:3100

## 已验证
好友已加上；QQ 私聊已能正常收发。直接发消息即可。

## 一键启动（推荐）
双击桌面「小鲸鱼一键启动」，或双击 `D:\Temp\qq-bridge\start-all.bat`。

脚本会自动按顺序：检测/启动 QQ → 启动 SnowLuma → 等 OneBot 3000/3001 就绪 → 启动 DSH Desktop → 启动 QQ 桥接 → 校验状态。
- 如果 QQ 需要扫码，脚本会打开 `http://127.0.0.1:5099`，登录后自动继续（最多等 4 分钟）。
- 成功窗口 8 秒后自动关闭；日志在 `D:\Temp\qq-bridge\state\start-all.log`。
- ComfyUI 不随一键启动（显卡占用大）；要画图时另外双击 `D:\Temp\qq-bridge\start-comfy.bat`。
- 控制台：http://127.0.0.1:3100

## 手动启动（备用）
1. 登录 QQ（机器人号 <机器人QQ>）。
2. 启动 SnowLuma：双击 `D:\Temp\SnowLuma\launcher.bat`，等 5099 页面能打开。
3. 要画图就启动 ComfyUI：双击 `D:\Temp\qq-bridge\start-comfy.bat`，等 8188 可访问。
4. 启动桥接：双击 `D:\Temp\qq-bridge\start-bridge.bat`。
5. 控制台打开 http://127.0.0.1:3100，看到 `SnowLuma 已连接`、`mode=closed-agent`、`role=小鲸鱼` 即可。

## 小鲸鱼的人格与 QQ 管理
- 人格卡：`D:\Temp\qq-bridge\roles\小鲸鱼.md`，由桥接每条消息注入，改完即生效，不用重启。
- QQ 管理工具：`D:\Temp\qq-bridge\scripts\qq-admin.mjs`，用 `D:\node.exe` 运行；能改资料/头像、发空间、管好友和群。
- 命令说明：`D:\Temp\qq-bridge\README-QQ管理.md`。
- 画图/改图：`D:\Temp\qq-bridge\scripts\comfy-draw.mjs`（ComfyUI 8188），支持文生图、图生图、局部重绘、14 种 ControlNet、高清二段；画完用 `qq-admin.mjs send-image` 发回 QQ，QQ 里的图可先 `download-image` 下载。
- 主动消息/自驱：`D:\Temp\qq-bridge\scripts\proactive.mjs`，默认随 `start-bridge.bat` 启动；静默 60 分钟、每 30–90 分钟检查、30% 概率、23:00–08:00 免打扰、每天最多 3 次。日志 `state\proactive.log`。
- 小鲸鱼的日记：`D:\Temp\qq-bridge\scripts\diary.mjs`，默认随 `start-bridge.bat` 启动；每天 00:00 后为昨天写日记，08:00 后晨读最近 7 天；电脑关机时下次启动补记。日记文件 `state\小鲸鱼-日记.md`，日志 `state\diary.log`。
- 切换到其他模式时，closed-agent 的完整工具会收回；人格仍在。

## 说明
- 桥接会从 `D:\Temp\SnowLuma\config\onebot_<机器人QQ>.json` 自动读取 OneBot 的 HTTP/WS token，不要手动改 token。
- DSH 的 `qq-chat` preset、MCP 已安装；DSH 重启后桥接如果断开，只需重新双击 `start-bridge.bat`。
- 日志：`D:\Temp\qq-bridge\state\bridge.log`；自动通过好友日志：`D:\Temp\qq-bridge\state\friend-ws.log`。
- 控制台 token：`D:\Temp\qq-bridge\state\console-token`。
- 风险：SnowLuma 是第三方注入，QQ 账号有封禁风险；不要外传 token，不要把这个端口暴露到公网。
