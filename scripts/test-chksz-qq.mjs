/**
 * ChKSz QQ 音乐接口调试脚本。
 *
 * 用法：
 *   1. 设置环境变量 CHKSZ_API_KEY 为你的 chksz_ 开头密钥
 *   2. node scripts/test-chksz-qq.mjs
 *
 * 或直接传入：
 *   node scripts/test-chksz-qq.mjs chksz_xxxxx
 */

const API_KEY = process.env.CHKSZ_API_KEY || process.argv[2] || ''
const BASE = 'https://api.chksz.com'

if (!API_KEY) {
  console.error('错误：请设置 CHKSZ_API_KEY 环境变量或作为参数传入')
  console.error('用法: node scripts/test-chksz-qq.mjs chksz_xxxxx')
  process.exit(1)
}

console.log('=== ChKSz QQ 音乐接口调试 ===')
console.log('API Key:', API_KEY.slice(0, 8) + '****')
console.log()

async function fetchJson(path, params) {
  const query = new URLSearchParams({ apikey: API_KEY, ...params })
  const url = BASE + path + '?' + query.toString()
  console.log('>>> GET', path)
  console.log('    params:', JSON.stringify(params))
  console.log('    full URL:', url.replace(API_KEY, 'chksz_***'))

  const start = Date.now()
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    })
    const elapsed = Date.now() - start
    const text = await res.text()
    console.log('<<< HTTP', res.statusCode || res.status, `(${elapsed}ms)`)
    console.log('    RateLimit headers:')
    for (const [k, v] of res.headers) {
      if (
        k.toLowerCase().includes('rate') ||
        k.toLowerCase().includes('quota') ||
        k.toLowerCase() === 'retry-after'
      ) {
        console.log('      ' + k + ':', v)
      }
    }

    let json
    try {
      json = JSON.parse(text)
    } catch {
      console.log('    body (non-JSON, first 500 chars):', text.slice(0, 500))
      return null
    }

    // 打印完整响应结构（截断大数组）
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
    console.log('    response:', preview.slice(0, 2000))
    console.log()
    return { status: res.statusCode || res.status, json, elapsed }
  } catch (err) {
    console.log('<<< ERROR:', err.message)
    console.log()
    return null
  }
}

async function main() {
  // === 测试 1: QQ 音乐搜索 ===
  console.log('========== 测试 1: QQ 音乐搜索 (qq_music?msg=) ==========')
  const search1 = await fetchJson('/api/qq_music', {
    msg: '周杰伦 晴天',
    num: 5,
  })

  if (search1?.json?.list?.length > 0) {
    console.log('✅ QQ 搜索成功，返回', search1.json.list.length, '首歌曲:')
    for (const item of search1.json.list) {
      console.log(`   [${item.n}] ${item.name} - ${item.singer} (mid: ${item.mid})`)
    }
    console.log()

    // === 测试 2: 用 mid 解析第一首歌 ===
    const firstMid = search1.json.list[0].mid
    if (firstMid) {
      console.log('========== 测试 2: QQ 音乐解析 (qq_music?mid=) ==========')
      const resolve1 = await fetchJson('/api/qq_music', {
        mid: firstMid,
        size: 'flac',
      })

      if (resolve1?.json?.url) {
        console.log('✅ QQ 解析成功:')
        console.log('   url:', resolve1.json.url.slice(0, 80) + '...')
        console.log('   bitrate:', resolve1.json.bitrate)
        console.log('   format:', resolve1.json.format)
        console.log('   cover:', resolve1.json.cover?.slice(0, 80))
        console.log('   lrc:', resolve1.json.lrc ? resolve1.json.lrc.slice(0, 80) + '...' : '(none)')
      } else {
        console.log('❌ QQ 解析失败：没有返回 url')
        console.log('   完整响应:', JSON.stringify(resolve1?.json, null, 2).slice(0, 1000))
      }
    }
  } else {
    console.log('❌ QQ 搜索失败：没有返回 list')
    console.log('   完整响应:', JSON.stringify(search1?.json, null, 2).slice(0, 1000))
  }

  console.log()

  // === 测试 3: QQ 搜索只有歌曲名 ===
  console.log('========== 测试 3: QQ 搜索只有歌曲名 (msg=晴天) ==========')
  const search2 = await fetchJson('/api/qq_music', {
    msg: '晴天',
    num: 3,
  })

  if (search2?.json?.list?.length > 0) {
    console.log('✅ QQ 搜索成功，返回', search2.json.list.length, '首歌曲')
  } else {
    console.log('❌ QQ 搜索失败')
  }

  console.log()

  // === 测试 4: 网易云搜索 (对比) ===
  console.log('========== 测试 4: 网易云搜索 (163_search?keyword=) ==========')
  const search3 = await fetchJson('/api/163_search', {
    keyword: '周杰伦 晴天',
    limit: 5,
    offset: 0,
  })

  if (search3?.json?.data?.length > 0) {
    console.log('✅ 网易云搜索成功，返回', search3.json.data.length, '首歌曲:')
    for (const item of search3.json.data) {
      console.log(`   ${item.name} - ${item.artists} (id: ${item.id})`)
    }
  } else {
    console.log('❌ 网易云搜索失败')
    console.log('   完整响应:', JSON.stringify(search3?.json, null, 2).slice(0, 1000))
  }

  console.log()
  console.log('=== 调试完成 ===')
}

main().catch((err) => {
  console.error('未捕获错误:', err)
  process.exit(1)
})
