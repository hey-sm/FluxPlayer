# 推送与发布流程

## 触发规则（先看这个）

`.github/workflows/release.yml` 只有两个触发条件：

| 动作                            | 是否跑 CI                         |
| ------------------------------- | --------------------------------- |
| 推送到 `main`                   | **不跑**。没有任何自动校验        |
| 推送 `v*` 标签                  | 跑完整流水线并创建 GitHub Release |
| Actions 页面手动 `Run workflow` | 跑校验与打包，**不**创建 Release  |

第一行是最容易踩的：日常推 `main` 没有 CI 兜底，**本地闸门就是唯一闸门**。等到推标签才发现测试挂，标签已经在远端了（恢复办法见下文）。

## 推 `main` 之前

工作流 `verify` job 跑的就是这五条，本地按同样顺序过一遍：

```bash
pnpm typecheck   # node + web + test 三套 tsconfig
pnpm lint        # oxlint
pnpm format      # oxfmt --check，不是 format:write
pnpm test        # vitest run
pnpm build && pnpm smoke && pnpm exec playwright test   # e2e 需要 out/ 产物
```

单测有一类坑本地天然测不到：`os.tmpdir()` 在 GitHub runner 上是 8.3 短名（`C:\Users\RUNNER~1\...`，因为账户名 `runneradmin` 超过 8 字符），本机通常是长名。想复现 runner 环境：

```powershell
$env:TEMP = '<一个 8.3 短名目录>'; $env:TMP = $env:TEMP; pnpm test
```

## 推 `v*` 标签之后

三段 job 串行，前一段挂了后面整段不跑：

```
verify (windows-latest)          typecheck / lint / format / test / build / smoke / e2e
   │                             + 校验标签名 === "v" + package.json version
   ▼
package (windows-latest ∥ macos-14)   两个平台并行打包、按需签名与验签
   │                             产物传 Actions Artifacts（保留 14 天）
   ▼
release (ubuntu-24.04)           仅标签触发；生成 SHA256SUMS.txt 并创建/更新 Release
```

产物：Windows 出 `dist/*.exe` + `latest.yml`，macOS 出 `dist/*.dmg` / `*.zip` + `latest-mac.yml`（`.yml` 是 electron-updater 的更新元数据，别漏传）。

Release 的行为：标签名含 `-` 时自动标记为 prerelease（`v0.1.0-alpha.1` 会是预发布，`v0.1.0` 不是）；同名 Release 已存在时走 `gh release upload --clobber` 覆盖资产，不会重复创建。

## 标签必须与版本号一致

`verify` job 会校验 `GITHUB_REF_NAME === 'v' + package.json.version`，不一致直接失败。所以发版是两步，顺序不能反：

```bash
# 1. 先改 package.json 的 version 并提交
git commit -am "chore: release v0.1.0"
# 2. 再打标签
git tag v0.1.0
git push origin main
git push origin v0.1.0
```

## 标签推出去才发现挂了

标签是不可变引用，但失败的标签**不会产出 Release**（`package` / `release` 都因 `needs` 未运行），所以此时还没有任何公开产物，两条路都安全：

**A. 移动标签**（适合刚推出去、没人拉过的情况）

```bash
git push origin :refs/tags/v0.1.0   # 删远端
git tag -d v0.1.0                   # 删本地
git tag v0.1.0                      # 在修复后的 commit 上重打
git push origin v0.1.0
```

**B. 版本前进**（已经有人拉过标签，或想留下失败记录）

改 `package.json` 到下一个版本，重新提交打标签。

想在推标签前先验证一遍，用 Actions 页面的 `Run workflow` 手动触发：它会跑完 `verify` 和 `package`，但 `release` job 因 `if: startsWith(github.ref, 'refs/tags/v')` 被跳过——不会误建 Release。

## 签名：有凭据才签，缺凭据不阻断

标签发布**优先签名但不强制**。CI 检测到凭据就签名并验签，没有则告警、产出未签名安装包，Release 照常创建。

### Windows Authenticode

需要受信任 CA 的 OV/EV 证书。无法导出为 PFX 的硬件令牌证书不能直接用于 GitHub hosted runner，这种情况改用 Microsoft Trusted Signing、SignPath 等远程签名方案。

不要提交证书文件，把 PFX 转成单行 Base64：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('windows-signing.pfx')) | Set-Clipboard
```

在 `Settings > Secrets and variables > Actions` 添加 `WINDOWS_CERTIFICATE_BASE64` 与 `WINDOWS_CERTIFICATE_PASSWORD`。工作流把证书写进 runner 临时目录，经 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` 交给 electron-builder，再用 `Get-AuthenticodeSignature` 验签三个文件：安装程序、`win-unpacked/FluxPlayer.exe`、以及 Wallpaper Engine 原生助手 `FluxPlayer.WallpaperEngine.Helper.exe`。证书和密码不会进入构建产物。

### macOS Developer ID 与公证

需要 Apple Developer Program、`Developer ID Application` 证书和 App Store Connect API Key：

```bash
base64 < developer-id-application.p12 | tr -d '\n'
base64 < AuthKey_ABC123.p8 | tr -d '\n'
```

Secrets：`MACOS_CERTIFICATE_BASE64`、`MACOS_CERTIFICATE_PASSWORD`、`APPLE_API_KEY_BASE64`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`。

electron-builder 以 hardened runtime 和 `resources/entitlements.mac.plist` 签名，再经 `notarytool` 公证，最后用 `codesign --verify --deep --strict` 和 `spctl --assess` 验签。缺证书时 CI 会把 `electron-builder.yml` 的 `notarize: true` 临时改成 `false`（否则 electron-builder 会强制索要 API Key 而失败），产出未签名 DMG/ZIP。

## 平台范围

只发 Windows 和 macOS，没有 Linux 目标（`electron-builder.yml` 里也没有 linux 配置）。Wallpaper Engine / DWM 集成是 Windows 专属，macOS 安装包可以正常播放音乐，Windows 专属的背景能力保持不可用。

更新通道固定 GitHub `hey-sm/FluxPlayer`。

## 手动构建

必须在对应操作系统上执行：

```bash
pnpm build:win    # Windows NSIS 安装包 → dist/
pnpm build:mac    # macOS DMG/ZIP → dist/（会先跑 pnpm icons:mac 生成 icns）
```
