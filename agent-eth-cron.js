import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

// 1. 定位并读取 AgentDesk 运行时信息以获取 Port 和 Token
function getWebServerInfoPath() {
  let userDataPath;
  if (process.platform === 'win32') {
    userDataPath = path.join(process.env.APPDATA, 'AgentDesk');
  } else if (process.platform === 'darwin') {
    userDataPath = path.join(os.homedir(), 'Library', 'Application Support', 'AgentDesk');
  } else {
    userDataPath = path.join(os.homedir(), '.config', 'AgentDesk');
  }
  return path.join(userDataPath, 'web-server-info.json');
}

// 2. 向 AgentDesk 发起任务请求
async function triggerAgentTask() {
  try {
    const infoPath = getWebServerInfoPath();
    const raw = await fs.readFile(infoPath, 'utf8');
    const { port, token } = JSON.parse(raw);

    const url = `http://localhost:${port}/api/agent/send?token=${token}`;
    const payload = {
      requestId: randomUUID(),
      sessionId: "telegram-remote", // 沿用手机端远端控制会话
      input: "请进行今天的以太坊市场分析：获取当前 ETH 最新价格、24小时涨跌幅，并使用 Google 搜索最近几个小时内关于以太坊的重要新闻或动态。整理成一份简短的中文 Markdown 报告，直接通过 Telegram 发送给我。",
      language: "zh",
      permissionMode: "full"
    };

    console.log(`[Scheduler] Triggering Agent task at port ${port}...`);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    console.log('[Scheduler] Agent response:', result);
  } catch (error) {
    console.error('[Scheduler] Failed to trigger Agent:', error.message);
  }
}

// 3. 定时逻辑：每天中午 12 点触发，且启动时立即执行一次测试
function startScheduler() {
  console.log("[Scheduler] Ethereum price tracker service started...");
  
  // 启动时立即运行一次进行测试/执行
  void triggerAgentTask();
  
  setInterval(() => {
    const now = new Date();
    // 检查时间是否是 12:00
    if (now.getHours() === 12 && now.getMinutes() === 0) {
      triggerAgentTask();
    }
  }, 60000); // 每分钟检查一次时间
}

startScheduler();
