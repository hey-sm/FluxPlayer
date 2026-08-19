# 跨平台构建与签名

仓库通过 `.github/workflows/release.yml` 在原生 GitHub runner 上构建桌面安装包：

- Windows x64：NSIS 安装程序。
- macOS x64 / arm64：DMG 安装镜像与自动更新所需 ZIP。
- Linux x64：AppImage 与 deb。

推送到 `main` 会运行完整校验并上传 Actions Artifacts。推送 `v*` 标签会在签名验证通过后创建 GitHub Release。标签必须与 `package.json` 版本完全一致，例如版本 `2.0.0-alpha.1` 对应：

```bash
git tag v2.0.0-alpha.1
git push origin v2.0.0-alpha.1
```

## Windows Authenticode 签名

公开发布需要受信任的 Authenticode 代码签名证书。可从受信任 CA 购买 OV/EV 证书；无法导出为 PFX 的硬件令牌证书不能直接用于 GitHub hosted runner，此时应改用 Microsoft Trusted Signing、SignPath 等远程签名方案。

当前工作流使用可导出的 PFX。不要提交证书文件，把 PFX 转为单行 Base64：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('windows-signing.pfx')) |
  Set-Clipboard
```

在 GitHub 仓库的 `Settings > Secrets and variables > Actions` 添加：

- `WINDOWS_CERTIFICATE_BASE64`：上一步的 Base64 内容。
- `WINDOWS_CERTIFICATE_PASSWORD`：PFX 密码。

工作流将证书写入 runner 临时目录，通过 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` 交给 electron-builder，并在标签发布时用 `Get-AuthenticodeSignature` 验证安装程序。证书和密码不会进入构建产物。

## macOS 签名与公证

macOS 对站外分发要求 Apple Developer Program、`Developer ID Application` 证书和 Apple 公证。导出证书与私钥为 P12/PFX，并创建 App Store Connect API Key。分别把证书和 `.p8` 转为 Base64：

```bash
base64 < developer-id-application.p12 | tr -d '\n'
base64 < AuthKey_ABC123.p8 | tr -d '\n'
```

添加以下 GitHub Actions Secrets：

- `MACOS_CERTIFICATE_BASE64`
- `MACOS_CERTIFICATE_PASSWORD`
- `APPLE_API_KEY_BASE64`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

electron-builder 会使用 hardened runtime 和 `resources/entitlements.mac.plist` 签名应用，然后通过 Apple `notarytool` 公证。标签发布缺少任一项都会失败，避免发布未签名或未公证的 macOS 安装包。

## Linux 与自动更新

Linux 没有与 Windows/macOS 对等的统一桌面签名体系。Release 会附带 `SHA256SUMS.txt`；AppImage 可使用现有 electron-updater 通道，deb 应由用户通过包管理器或 GitHub Release 手动升级。

Wallpaper Engine/DWM 集成仅在 Windows 可用。macOS 和 Linux 安装包可以运行播放器，其 Windows 专属背景能力会保持不可用状态。

## 手动构建

必须在对应操作系统执行：

```bash
pnpm build:win
pnpm build:mac
pnpm build:linux
```

普通 `main` 构建在没有 Secrets 时仍会生成未签名 Actions Artifacts用于测试；`v*` 标签发布强制要求 Windows 与 macOS 签名凭据。
