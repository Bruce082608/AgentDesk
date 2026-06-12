import { desktopCapturer, screen } from "electron";

export async function capturePrimaryScreen() {
  if (typeof desktopCapturer === "undefined" || typeof screen === "undefined" || !desktopCapturer || !screen) {
    throw new Error("截屏功能仅在 Electron 桌面客户端运行时可用。");
  }
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;
  
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: Math.floor(width), height: Math.floor(height) }
  });
  
  const primarySource = sources[0];
  if (!primarySource) {
    throw new Error("未找到任何可用屏幕数据");
  }
  
  return primarySource.thumbnail.toPNG();
}
