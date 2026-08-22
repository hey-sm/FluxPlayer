# 推送与发布流程

## 触发规则

`.github/workflows/release.yml` 的三种情况：

| 动作                            | 结果                              |
| ------------------------------- | --------------------------------- |
| 推送到 `main`                   | **不跑 CI**，随便推               |
| Actions 页面手动 `Run workflow` | 跑校验与打包，**不**创建 Release  |
| 推送 `v*` 标签                  | 跑完整流水线并创建 GitHub Release |

推荐节奏：日常推 `main` 不用管 CI；**准备发版时先手动 `Run workflow` 跑一遍**，绿了再打标签。手动触发时 `release` job 会因 `if: startsWith(github.ref, 'refs/tags/v')` 被跳过，不会误发。

跳过这一步的代价是真实的：标签推出去才发现测试挂，就得回来移动标签重来。

## 发版两步

顺序不能反，`verify` job 会校验 `GITHUB_REF_NAME === 'v' + package.json.version`，不一致直接失败：

```bash
# 1. 先改 package.json 的 version 并提交
git commit -am "chore: release v0.1.0"
git push origin main
# 2. 再打标签
git tag v0.1.0
git push origin v0.1.0
```

## 流水线三段

前一段挂了后面整段不跑：

```
verify (windows-latest)          typecheck / lint / format / test / build / smoke / e2e
   │                             + 标签触发时校验标签名与版本号一致
   ▼
package (windows-latest ∥ macos-14)   两平台并行打包、按需签名与验签
   │                             产物传 Actions Artifacts（保留 14 天）
   ▼
release (ubuntu-24.04)           仅标签触发；生成 SHA256SUMS.txt 并创建/更新 Release
```

产物：Windows 出 `dist/*.exe` + `latest.yml`，macOS 出 `dist/*.dmg` / `*.zip` + `latest-mac.yml`（`.yml` 是 electron-updater 的更新元数据，别漏传）。标签名含 `-` 会自动标记为 prerelease；同名 Release 已存在时覆盖资产而不是重建。

## 标签推出去才发现挂了

失败的标签**不会产出 Release**（`package` / `release` 都因 `needs` 未运行），此时没有任何公开产物，两条路都安全：

**A. 移动标签**（刚推出去、没人拉过）

```bash
git push origin :refs/tags/v0.1.0   # 删远端
git tag -d v0.1.0                   # 删本地
git tag v0.1.0                      # 在修复后的 commit 上重打
git push origin v0.1.0
```

**B. 版本前进**（已经有人拉过，或想留下失败记录）：改 `package.json` 到下一个版本，重新提交打标签。

## 签名（可选，缺凭据不阻断）

当前没有配置签名凭据，CI 会告警并产出**未签名**安装包，Release 照常创建。配置后自动签名并验签（Windows 用 `Get-AuthenticodeSignature`，macOS 用 `codesign` + `spctl`）。

需要时在 `Settings > Secrets and variables > Actions` 添加：

| Secret                                                           | 用途                                     |
| ---------------------------------------------------------------- | ---------------------------------------- |
| `WINDOWS_CERTIFICATE_BASE64` / `WINDOWS_CERTIFICATE_PASSWORD`    | Windows Authenticode，PFX 转单行 Base64  |
| `MACOS_CERTIFICATE_BASE64` / `MACOS_CERTIFICATE_PASSWORD`        | macOS Developer ID，P12 转 Base64        |
| `APPLE_API_KEY_BASE64` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` | Apple 公证用的 App Store Connect API Key |

Windows 硬件令牌证书无法导出为 PFX，不能直接用于 GitHub hosted runner，需改用 Microsoft Trusted Signing 或 SignPath 等远程签名方案。缺 macOS 证书时 CI 会把 `electron-builder.yml` 的 `notarize: true` 临时改成 `false`，否则 electron-builder 会强制索要 API Key 而失败。

## 平台与手动构建

只发 Windows 和 macOS，没有 Linux 目标。Wallpaper Engine / DWM 集成是 Windows 专属，macOS 装上能正常播放音乐，Windows 专属的背景能力保持不可用。更新通道固定 GitHub `hey-sm/FluxPlayer`。

```bash
pnpm build:win    # Windows NSIS 安装包 → dist/
pnpm build:mac    # macOS DMG/ZIP → dist/（会先跑 pnpm icons:mac 生成 icns）
```
