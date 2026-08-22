/**
 * ChKSz 接口调试脚本（Electron 环境）。
 *
 * 这个脚本在 Electron 主进程中运行，用 SafeCredentialStore 读取已保存的 chksz 密钥，
 * 然后直接调用 chksz QQ 音乐接口，打印完整的请求和响应。
 *
 * 用法：
 *   npx electron scripts/test-chksz-electron.cjs
 *
 * 也可以手动传入密钥：
 *   npx electron scripts/test-chksz-electron.cjs chksz_xxxxx
 */

const { app, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

// 必须在 whenReady 之前设置 app name，让 userData 指向 FluxPlayer 目录
app.setName('FluxPlayer')

const manualKey = process.argv[2] || ''

// 不要弹窗口
app.whenReady().then(async () => {
  try {
    let apiKey = manualKey

    // 如果没有手动传入密钥，从凭据存储读取
    if (!apiKey) {
      const credDir = path.join(app.getPath('userData'), 'credentials')
      const credFile = path.join(credDir, 'chksz.bin')
      console.log('凭据目录:', credDir)

      if (!fs.existsSync(credFile)) {
        console.error('错误：未找到 chksz.bin 凭据文件，请先在设置中保存密钥')
        console.error('或手动传入: npx electron scripts/test-chksz-electron.cjs chksz_xxxxx')
        app.exit(1)
        return
      }

      if (!safeStorage.isEncryptionAvailable()) {
        console.error('错误：系统加密不可用，无法解密密钥')
        app.exit(1)
        return
      }

      const encrypted = fs.readFileSync(credFile)
      apiKey = safeStorage.decryptString(encrypted)
      console.log('已从凭据存储读取 chksz 密钥')
    } else {
      console.log('使用手动传入的密钥')
    }

    console.log('API Key:', apiKey.slice(0, 8) + '****')
    console.log('')

    await runTests(apiKey)
  } catch (err) {
    console.error('运行失败:', err)
    app.exit(1)
  }
})

async function fetchJson(url) {
  console.log('>>> GET', url.replace(/apikey=[^&]+/, 'apikey=chksz_***'))
  const start = Date.now()
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  })
  const elapsed = Date.now() - start
  const text = await res.text()
  console.log('<<< HTTP', res.status, `(${elapsed}ms)`)

  // 打印限流/配额头
  const rateHeaders = {}
  for (const [k, v] of res.headers) {
    if (
      k.toLowerCase().includes('rate') ||
      k.toLowerCase().includes('quota') ||
      k.toLowerCase() === 'retry-after'
    ) {
      rateHeaders[k] = v
    }
  }
  if (Object.keys(rateHeaders).length > 0) {
    console.log('    限流/配额头:', JSON.stringify(rateHeaders))
  }

  let json
  try {
    json = JSON.parse(text)
  } catch {
    console.log('    body (非 JSON):', text.slice(0, 500))
    return { status: res.status, text }
  }

  // 打印响应结构（截断大数组）
  const preview = JSON.stringify(
    json,
    (key, value) => {
      if (Array.isArray(value) && value.length > 3) {
        return [`Array(${value.length})`, ...value.slice(0, 3)]
      }
      return value
    },
    2,
  )
  console.log('    response:', preview.slice(0, 3000))
  console.log('')
  return { status: res.status, json, elapsed }
}

async function runTests(apiKey) {
  const BASE = 'https://api.chksz.com'

  // === 测试 1: QQ 音乐搜索（歌名+歌手） ===
  console.log('========== 测试 1: QQ 搜索 msg="周杰伦 晴天" num=5 ==========')
  const url1 = `${BASE}/api/qq_music?msg=${encodeURIComponent('周杰伦 晴天')}&num=5&apikey=${apiKey}`
  const r1 = await fetchJson(url1)

  if (r1.json && r1.json.list && r1.json.list.length > 0) {
    console.log('✅ QQ 搜索成功，返回', r1.json.list.length, '首:')
    for (const item of r1.json.list) {
      console.log(
        `   [${item.n}] ${item.name} - ${item.singer} | album: ${item.album} | mid: ${item.mid} | pay: ${item.pay}`,
      )
    }
    console.log('')

    // === 测试 2: 用 mid 解析第一首 ===
    const firstMid = r1.json.list[0].mid
    console.log('========== 测试 2: QQ 解析 mid=' + firstMid + ' size=flac ==========')
    const url2 = `${BASE}/api/qq_music?mid=${firstMid}&size=flac&apikey=${apiKey}`
    const r2 = await fetchJson(url2)

    if (r2.json && r2.json.url) {
      console.log('✅ QQ 解析成功:')
      console.log('   url:', r2.json.url.slice(0, 100) + '...')
      console.log('   bitrate:', r2.json.bitrate)
      console.log('   format:', r2.json.format)
      console.log('   name:', r2.json.name)
      console.log('   singer:', r2.json.singer)
      console.log('   cover:', r2.json.cover ? r2.json.cover.slice(0, 100) : '(none)')
      console.log('   lrc:', r2.json.lrc ? r2.json.lrc.slice(0, 100) + '...' : '(none)')
      console.log('   interval:', r2.json.interval)
    } else {
      console.log('❌ QQ 解析失败：没有 url')
      console.log('   msg:', r2.json?.msg)
    }
    console.log('')

    // === 测试 3: 用 mid 解析 size=320k ===
    console.log('========== 测试 3: QQ 解析 mid=' + firstMid + ' size=320k ==========')
    const url3 = `${BASE}/api/qq_music?mid=${firstMid}&size=320k&apikey=${apiKey}`
    const r3 = await fetchJson(url3)
    console.log('   有 url:', Boolean(r3.json?.url))
    console.log('')
  } else {
    console.log('❌ QQ 搜索失败：list 为空或不存在')
    console.log('   code:', r1.json?.code, 'msg:', r1.json?.msg)
    console.log('')
  }

  // === 测试 4: QQ 搜索只用歌名 ===
  console.log('========== 测试 4: QQ 搜索 msg="晴天" num=3 ==========')
  const url4 = `${BASE}/api/qq_music?msg=${encodeURIComponent('晴天')}&num=3&apikey=${apiKey}`
  const r4 = await fetchJson(url4)
  if (r4.json && r4.json.list) {
    console.log('✅ 返回', r4.json.list.length, '首')
  }
  console.log('')

  // === 测试 5: 网易云搜索（对比） ===
  console.log('========== 测试 5: 网易云搜索 keyword="周杰伦 晴天" limit=5 ==========')
  const url5 = `${BASE}/api/163_search?keyword=${encodeURIComponent('周杰伦 晴天')}&limit=5&offset=0&apikey=${apiKey}`
  const r5 = await fetchJson(url5)
  // data 可能是数组或 { songs: [...] }
  const neData = r5.json?.data
  const neSongs = Array.isArray(neData) ? neData : neData?.songs || neData?.result || []
  if (neSongs.length > 0) {
    console.log('✅ 网易云搜索成功，返回', neSongs.length, '首:')
    for (const item of neSongs) {
      console.log(
        `   ${item.name} - ${item.artists} | album: ${item.album} | id: ${item.id} | duration: ${item.duration}`,
      )
    }
  } else {
    console.log('❌ 网易云搜索失败')
    console.log('   data 结构:', typeof neData, Array.isArray(neData) ? 'array' : 'object')
  }
  console.log('')

  // === 测试 6: 网易云解析 (用搜索结果的真实 ID) ===
  const neFirstId = neSongs[0]?.id
  if (neFirstId) {
    console.log('========== 测试 6: 网易云解析 163_music id=' + neFirstId + ' level=exhigh ==========')
    const url6 = `${BASE}/api/163_music?id=${neFirstId}&level=exhigh&type=json&apikey=${apiKey}`
    const r6 = await fetchJson(url6)
    if (r6.json && r6.json.data && r6.json.data.url) {
      console.log('✅ 网易云解析成功:')
      console.log('   url:', r6.json.data.url.slice(0, 100) + '...')
      console.log('   br:', r6.json.data.br)
      console.log('   level:', r6.json.data.level)
      console.log('   name:', r6.json.data.name)
      console.log('   artist:', r6.json.data.artist)
    } else {
      console.log('❌ 网易云解析失败:', r6.json?.msg)
    }
  }
  console.log('')

  console.log('========== 全部测试完成 ==========')
  app.exit(0)
}
