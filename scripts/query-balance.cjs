// Script to read the API key using Electron's safeStorage and query DeepSeek balance
const { app, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");

app.whenReady().then(async () => {
    try {
        const basePath = app.getPath("appData"); // %APPDATA%
        const possiblePaths = [
            path.join(basePath, "AgentDesk", "secrets.json"),
            path.join(basePath, "agentdesk", "secrets.json"),
        ];
        
        let apiKey = "";
        for (const secretsPath of possiblePaths) {
            console.log("Trying:", secretsPath);
            try {
                const raw = fs.readFileSync(secretsPath, "utf8");
                const data = JSON.parse(raw);
                if (data.storage === "safeStorage" && data.apiKey) {
                    apiKey = safeStorage.decryptString(Buffer.from(data.apiKey, "base64"));
                    console.log("API Key found (length " + apiKey.length + "): " + apiKey.substring(0, 6) + "..." + apiKey.substring(apiKey.length - 4));
                    break;
                }
            } catch (e) {
                console.log("  Failed:", e.code || e.message);
            }
        }

        if (!apiKey) {
            console.log("No API key found");
            app.quit();
            return;
        }

        // Now query the DeepSeek balance
        console.log("\nQuerying DeepSeek balance...");
        const response = await fetch("https://api.deepseek.com/user/balance", {
            headers: { Authorization: "Bearer " + apiKey }
        });
        const data = await response.json();
        console.log(JSON.stringify(data, null, 2));
        
    } catch (err) {
        console.error("Error:", err.message);
    }
    app.quit();
});
