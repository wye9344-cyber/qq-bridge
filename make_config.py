import json, os

repo = r"D:\Temp\qq-bridge"
src = os.path.join(repo, "config.example.json")
dst = os.path.join(repo, "config.json")
with open(src, encoding="utf-8") as f:
    cfg = json.load(f)

cfg["dsh"].update(
    {
        "baseUrl": "http://127.0.0.1:43120",
        "provider": "deepseek-account",
        "model": "deepseek-flash",
        "reasoningEffort": "max",
        "authToken": "",
    }
)
cfg["snowluma"].update(
    {
        "wsUrl": "ws://127.0.0.1:3001",
        "httpUrl": "http://127.0.0.1:3000",
        "accessToken": "",
        "followDiscoveredEndpoint": True,
        "launcherPath": "D:/Temp/SnowLuma/launcher.bat",
        "homeDir": "D:/Temp/SnowLuma",
    }
)
cfg["ownerQQ"] = None
cfg["allow"] = {"private": [], "groups": []}
cfg["allowAllWhenEmpty"] = False
cfg["agentPreset"] = "qq-chat"
cfg["consolePort"] = 3100
cfg["consoleToken"] = ""

with open(dst, "w", encoding="utf-8") as f:
    json.dump(cfg, f, ensure_ascii=False, indent=2)

print(dst)
print(cfg["dsh"])
print(cfg["snowluma"])
print("ownerQQ", cfg["ownerQQ"], "allow", cfg["allow"])
