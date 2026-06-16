const { safeStorage, app } = require('electron');
const fs = require('fs');
const path = require('path');

const secretsPath = path.join('/Users/bruce/Library/Application Support/agentdesk', 'secrets.json');
const outputPath = '/tmp/token_output.txt';

try {
  const raw = fs.readFileSync(secretsPath, 'utf8');
  const data = JSON.parse(raw);
  
  fs.writeFileSync(outputPath, 'safeStorage available: ' + safeStorage.isEncryptionAvailable() + '\n');
  fs.appendFileSync(outputPath, 'app name: ' + app.getName() + '\n');
  
  if (data.telegramBotToken) {
    const decrypted = safeStorage.decryptString(Buffer.from(data.telegramBotToken, 'base64'));
    fs.appendFileSync(outputPath, 'BOT_TOKEN:' + decrypted + '\n');
  } else {
    fs.appendFileSync(outputPath, 'No telegramBotToken in secrets\n');
  }
  
  if (data.apiKey) {
    const decrypted = safeStorage.decryptString(Buffer.from(data.apiKey, 'base64'));
    fs.appendFileSync(outputPath, 'API_KEY:' + decrypted + '\n');
  }
  
  fs.appendFileSync(outputPath, 'DONE\n');
  app.quit();
} catch (err) {
  fs.writeFileSync(outputPath, 'Error: ' + err.message + '\nStack: ' + err.stack + '\n');
  app.quit();
}
