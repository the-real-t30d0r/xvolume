// scripts/buildExe.js
const exe = require("@angablue/exe");

const build = exe({
  entry: "dist/main.js",
  out: "XVolume-1.1.4.exe",
  skipBundle: false,
  version: "1.1.4",
  icon: "assets/myIcon.ico",
  executionLevel: "asInvoker",
  properties: {
    FileDescription: "A futuristic Open-Source Solana Volume/Multi-Buy/Multi-Sell",
    ProductName: "XVOLUME-CLI",
    OriginalFilename: "XVolume-1.1.4.exe",
    CompanyName: "the-real-t30d0r (github)"
  }
});

build
  .then(() => console.log("✅ Build completed!"))
  .catch((err) => console.error("❌ Build error:", err));
