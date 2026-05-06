const { app, safeStorage } = require("electron");

app.whenReady().then(() => {
  const available = safeStorage.isEncryptionAvailable();
  const backend = typeof safeStorage.getSelectedStorageBackend === "function"
    ? safeStorage.getSelectedStorageBackend()
    : null;
  let roundTrip = false;

  if (available) {
    const encrypted = safeStorage.encryptString("codex-safe-storage-test");
    roundTrip = safeStorage.decryptString(encrypted) === "codex-safe-storage-test";
  }

  console.log(JSON.stringify({
    platform: process.platform,
    available,
    backend,
    roundTrip
  }, null, 2));
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
