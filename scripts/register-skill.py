import requests
import json
import time

TOKEN = "d09ab8d7-ad47-4767-b9f5-ebe315f197fe"
BASE = f"http://localhost:5175/api"

# Node.js code that runs the Python ETH tracker script
# Using double backslashes for the JSON encoding
skill_code = r"""const { execSync } = require('child_process');
try {
  const result = execSync('python C:\\code\\AgentDesk\\scripts\\eth-price-tracker.py', {
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true
  });
  console.log(result);
} catch (err) {
  console.error('ETH价格追踪失败:', err.message);
  process.exit(1);
}
"""

now_ms = int(time.time() * 1000)

# Step 1: get current skills
print("[1] 获取当前 skills...")
r = requests.get(f"{BASE}/skills?token={TOKEN}")
print(f"  GET status: {r.status_code}")
current_skills = r.json() if r.status_code == 200 else []
print(f"  当前 skills 数量: {len(current_skills)}")

# Step 2: build new skill list (replace any existing with same id)
skills = [s for s in current_skills if s.get('id') != 'eth-price-tracker']

new_skill = {
    "id": "eth-price-tracker",
    "title": "ETH 价格追踪器",
    "description": "每天中午12点自动获取ETH最新价格，更新桌面Excel表格（ETH-Price-Tracker.xlsx）",
    "enabled": True,
    "type": "code",
    "code": skill_code,
    "prompt": "",
    "intervalMinutes": 1440,
    "runAt": 0,
    "createdAt": now_ms,
    "updatedAt": now_ms
}

skills.append(new_skill)

print(f"\n[2] 保存 skills (共 {len(skills)} 个)...")
r = requests.post(f"{BASE}/skills?token={TOKEN}", json=skills)
print(f"  POST status: {r.status_code}")
print(f"  响应: {r.json()}")

if r.status_code == 200:
    print("\n[SUCCESS] 技能已成功注册！")
    print("  技能将在调度器同步后约5秒执行一次，之后每1440分钟（24小时）运行")
else:
    print(f"\n[ERROR] 注册失败: {r.text}")

# Step 3: verify
print("\n[3] 验证注册结果...")
r = requests.get(f"{BASE}/skills?token={TOKEN}")
if r.status_code == 200:
    skills_list = r.json()
    for s in skills_list:
        print(f"  - {s.get('id')}: {s.get('title')} (enabled={s.get('enabled')}, interval={s.get('intervalMinutes')}min)")
else:
    print(f"  验证失败: {r.status_code}")
