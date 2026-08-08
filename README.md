# Tunnex — Visual SSH Tunnel & Local Port Forwarding Manager

<p align="center">
  <img src="Tunnex.png" alt="Tunnex Application Screenshot" width="100%" />
</p>

<p align="center">
  <strong>Tunnex</strong> is a high-performance, native Windows application built with <strong>Tauri v2</strong>, <strong>Rust</strong>, and <strong>React 19</strong> designed to manage SSH profiles and local port forwarding rules with live real-time telemetry, native Windows Credential Manager security, and one-click browser integration.
</p>

<p align="center">
  <a href="https://github.com/jaimitus/Tunnex/releases/tag/v1.0.0"><img src="https://img.shields.io/badge/Download-v1.0.0-emerald?style=for-the-badge&logo=github" alt="Download v1.0.0"></a>
  <a href="https://github.com/jaimitus/Tunnex"><img src="https://img.shields.io/badge/GitHub-jaimitus%2FTunnex-orange?style=for-the-badge&logo=github" alt="GitHub Repository"></a>
  <a href="https://buymeacoffee.com/jaimitus"><img src="https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Donate-orange.svg?style=for-the-badge&logo=buy-me-a-coffee" alt="Buy Me A Coffee"></a>
  <img src="https://img.shields.io/badge/Platform-Windows%2010%2F11-blue?style=for-the-badge&logo=windows" alt="Platform Windows"></a>
  <img src="https://img.shields.io/badge/Backend-Rust%20%2B%20Tokio%20%2B%20Russh-red?style=for-the-badge&logo=rust" alt="Rust Backend"></a>
</p>

---

## 📥 Download Release (v1.0.0)

Download pre-compiled Windows binaries from the official [v1.0.0 Release Page](https://github.com/jaimitus/Tunnex/releases/tag/v1.0.0):

<p align="center">
  <a href="https://github.com/jaimitus/Tunnex/releases/download/v1.0.0/Tunnex_1.0.0_x64-setup.exe"><img src="https://img.shields.io/badge/Download-NSIS%20Installer%20(.exe)-brightgreen?style=for-the-badge&logo=windows" alt="Download NSIS Setup"></a>
  <a href="https://github.com/jaimitus/Tunnex/releases/download/v1.0.0/Tunnex_1.0.0_x64_en-US.msi"><img src="https://img.shields.io/badge/Download-MSI%20Installer%20(.msi)-blue?style=for-the-badge&logo=windows" alt="Download MSI Installer"></a>
  <a href="https://github.com/jaimitus/Tunnex/releases/download/v1.0.0/Tunnex_1.0.0_Portable.zip"><img src="https://img.shields.io/badge/Download-Portable%20(.zip)-orange?style=for-the-badge" alt="Download Portable Zip"></a>
</p>

| Package | Format | Direct Download Link |
| :--- | :--- | :--- |
| **NSIS Setup Installer** *(Recommended)* | `.exe` | [Tunnex_1.0.0_x64-setup.exe](https://github.com/jaimitus/Tunnex/releases/download/v1.0.0/Tunnex_1.0.0_x64-setup.exe) |
| **MSI Package** | `.msi` | [Tunnex_1.0.0_x64_en-US.msi](https://github.com/jaimitus/Tunnex/releases/download/v1.0.0/Tunnex_1.0.0_x64_en-US.msi) |
| **Portable Package (ZIP)** | `.zip` | [Tunnex_1.0.0_Portable.zip](https://github.com/jaimitus/Tunnex/releases/download/v1.0.0/Tunnex_1.0.0_Portable.zip) |
| **Standalone Executable** | `.exe` | [tunnex.exe](https://github.com/jaimitus/Tunnex/releases/download/v1.0.0/tunnex.exe) |

---

## ✨ Core Features

- **🚀 Async SSH Tunnel Engine (`direct-tcpip`)**: Powered by `tokio` multi-threaded async runtime and `russh` SSH stack. Each forwarded local port (`127.0.0.1:<local_port>`) opens real-time SSH channels to the remote service.
- **🔐 Hardware-grade Credential Storage (DPAPI)**: Passwords and private key passphrases are never saved in JSON files. They are securely encrypted and stored using the **Windows Credential Manager** (`keyring` under the `tunnex` service).
- **⚡ Smart Auto-Insert Ports**: One-click **Auto Insert** helper automatically finds and assigns unused local ports (`8080`, `5432`, `3000`, etc.), populates target hosts, and generates rule names.
- **🌐 One-Click Browser Launch**: Click on any local endpoint (`127.0.0.1:<port>`) or the browser button to instantly open target web services (Adminer, PostgreSQL Web, Redis UI, etc.) in your system's default browser.
- **🖥️ Native Windows PowerShell Integration**: Launch detached PowerShell, PowerShell Core 7 (`pwsh`), or Windows Terminal (`wt.exe`) windows pre-configured with active SSH sessions (`ssh -p <port> -i <key> user@host`) or diagnostic scripts (`Test-NetConnection`).
- **📊 Real-time Traffic Telemetry & Sparklines**: Monitor live throughput (bytes sent/received), active connections, and session uptime with smooth SVG sparkline charts.
- **📌 System Tray Context Menu**: Minimize to tray with active background tunnels. Manage global connections (*Connect all*, *Disconnect all*, *Open PowerShell*, *Quit*) directly from the tray context menu.

---

## 🛠️ Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Desktop Framework** | [Tauri v2](https://tauri.app) (Native Windows Windowing & System Tray) |
| **Backend Language** | [Rust](https://www.rust-lang.org/) (`x86_64-pc-windows-msvc`) |
| **Async Runtime** | [Tokio](https://tokio.rs/) & [Russh](https://github.com/warp-tech/russh) |
| **Security** | Windows Credential Manager (`keyring` / DPAPI) |
| **Frontend Framework** | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) |
| **Styling & Icons** | [Tailwind CSS v4](https://tailwindcss.com/) + [Lucide Icons](https://lucide.dev/) |

---

## 🚀 Getting Started & Building from Source

### Prerequisites

1. **Node.js** (v18+ recommended)
2. **Rust Toolchain** with `x86_64-pc-windows-msvc`:
   ```powershell
   rustup default stable-x86_64-pc-windows-msvc
   ```

### Installation & Development

```powershell
# Clone the repository
git clone https://github.com/jaimitus/Tunnex.git
cd Tunnex

# Install node dependencies
npm install

# Run application in development mode
npx tauri dev
```

### Production Build (`.exe` & Installers)

To compile the standalone production executable and installer bundles:

```powershell
# Generate application icons
npx @tauri-apps/cli icon src-tauri/icons/icon.png

# Build release bundle
npx tauri build
```

---

## ☕ Support & Donations

If you find **Tunnex** useful, consider supporting the development!

<p align="left">
  <a href="https://buymeacoffee.com/jaimitus" target="_blank">
    <img src="https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Donate-orange.svg?style=for-the-badge&logo=buy-me-a-coffee" alt="Buy Me A Coffee">
  </a>
</p>

---

## 📁 Configuration & Logs

- **Configuration File**: `%APPDATA%\tunnex\config.json` (saved atomically)
- **Windows Credential Service**: `tunnex` (Windows Credential Manager)

---

## 📄 Repository & License

- **GitHub Repository**: [https://github.com/jaimitus/Tunnex](https://github.com/jaimitus/Tunnex)
- **Official Releases**: [https://github.com/jaimitus/Tunnex/releases](https://github.com/jaimitus/Tunnex/releases)
- **License**: MIT License © [jaimitus](https://github.com/jaimitus)
