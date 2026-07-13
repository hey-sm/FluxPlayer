#!/usr/bin/env node
/**
 * 录制真实上游响应 → tests/fixtures/**（映射层 fixture 快照测试的输入）。
 *
 * 用法:
 *   node scripts/record-fixtures.mjs [qq|netease|weather|all]   （默认 all）
 *   pnpm record:fixtures
 *
 * 约定:
 * - 全部匿名调用、零 cookie；写盘前做凭据断言扫描，命中即拒绝落盘。
 * - QQ 请求参数必须与 src/server/providers/qq/{client,index}.ts 保持一字不差；
 *   下方 UA/requestText/parseJSONText 是 src/server/util/http.ts 的最小副本
 *   （本脚本跑在纯 node 下无法 import TS 源码）——改动 http.ts 或 provider 请求参数时同步这里。
 * - 列表统一截断 ≤5 条（形状无损），envelope 的 trimmed 字段记录截断位置。
 * - 单路失败不写文件、整体 exit 1；旧 fixture 不会被失败覆盖。
 * - 接口漂移报警流程：pnpm record:fixtures && pnpm test（分诊规则见 tests/unit/*-fixture.test.ts 头注释）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ===== src/server/util/http.ts 的最小副本（保持同步）=====
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function requestText(targetUrl, opts = {}, body) {
  const resp = await fetch(targetUrl, {
    method: opts.method || 'GET',
    headers: opts.headers || {},
    body: body ?? undefined,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10000),
    redirect: 'follow',
  })
  const text = await resp.text()
  if (resp.status >= 400) throw new Error('HTTP ' + resp.status + ' :: ' + text.slice(0, 200))
  return text
}

function parseJSONText(text) {
  try {
    return JSON.parse(String(text || '').replace(/^﻿/, ''))
  } catch {
    const match = String(text || '').match(/^[\w$.]+\(([\s\S]*)\)\s*;?\s*$/)
    if (match) return JSON.parse(match[1])
    throw new Error('Invalid JSON from upstream')
  }
}

async function requestJson(targetUrl, opts = {}, body) {
  return parseJSONText(await requestText(targetUrl, opts, body))
}

// ===== QQ 端点与请求头（与 providers/qq/client.ts 一致）=====
const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
const QQ_SMARTBOX_URL = 'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg'
const QQ_CDLIST_URL = 'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg'
const QQ_DISS_SQUARE_URL = 'https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg'
const QQ_HEADERS = { Referer: 'https://y.qq.com/', 'User-Agent': UA }

async function musicuRequest(payload) {
  // 匿名：不带 Cookie（与 QQClient.musicuRequest 在无 cookie 时的行为一致）
  const headers = { ...QQ_HEADERS, 'Content-Type': 'application/json;charset=UTF-8' }
  return parseJSONText(await requestText(QQ_MUSICU_URL, { method: 'POST', headers }, JSON.stringify(payload)))
}

// ===== 安全闸与工具 =====

/** 凭据断言扫描：发现疑似凭据即抛错终止（绝不静默删除——fixture 必须保持 raw） */
function assertNoCredentials(value, file) {
  const suspiciousKey = /cookie|authst|musickey|qm_keyst|access_token|refresh_token|passwd|password/i
  JSON.stringify(value, (k, v) => {
    const filled =
      typeof v === 'string'
        ? v.trim().length > 0
        : Array.isArray(v)
          ? v.length > 0
          : !!v && typeof v === 'object'
            ? Object.keys(v).length > 0
            : false
    if (k && suspiciousKey.test(k) && filled) throw new Error(`${file}: 疑似凭据字段 "${k}"，拒绝落盘`)
    if (typeof v === 'string' && /(qm_keyst|MUSIC_U)=[\w+/=-]{16,}/.test(v)) {
      throw new Error(`${file}: 字符串值中疑似凭据，拒绝落盘`)
    }
    return v
  })
}

/** 按 a.b.0.c 路径把数组截断到 n 条，返回 trimmed 记录（未截断返回 null） */
function trimAt(obj, dotPath, n = 5) {
  const segs = dotPath.split('.')
  let target = obj
  for (const seg of segs.slice(0, -1)) target = target && target[seg]
  const last = segs[segs.length - 1]
  const arr = target && target[last]
  if (!Array.isArray(arr) || arr.length <= n) return null
  target[last] = arr.slice(0, n)
  return { [dotPath]: n }
}

function writeFixture(rel, { endpoint, method, params, trimmed }, response) {
  assertNoCredentials(response, rel)
  const doc = {
    $fixture: {
      recordedAt: new Date().toISOString(),
      provenance: 'recorded',
      endpoint,
      method,
      params,
      ...(trimmed ? { trimmed } : {}),
      anonymous: true,
    },
    response,
  }
  const file = path.join(root, 'tests', 'fixtures', rel)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n')
  console.log('[record] OK   ' + rel)
}

let failed = false
async function run(rel, fn) {
  try {
    await fn(rel)
  } catch (e) {
    failed = true
    console.error('[record] FAIL ' + rel + ' :: ' + (e && e.message))
  }
}

// ===== QQ =====

async function recordQQ() {
  await run('qq/smartbox-search.fixture.json', async (rel) => {
    // 参数照抄 QQProvider.smartboxSearch
    const params = {
      format: 'json',
      key: '周杰伦 晴天',
      g_tk: '5381',
      loginUin: '0',
      hostUin: '0',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq.json',
      needNewCode: '0',
    }
    const u = new URL(QQ_SMARTBOX_URL)
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
    const json = await requestJson(u.toString(), { headers: QQ_HEADERS })
    const items = json && json.data && json.data.song && json.data.song.itemlist
    if (!Array.isArray(items) || !items.length) throw new Error('响应缺 data.song.itemlist（形状漂移或风控）')
    const trimmed = trimAt(json, 'data.song.itemlist', 5)
    writeFixture(rel, { endpoint: QQ_SMARTBOX_URL, method: 'GET', params, trimmed }, json)
  })

  await run('qq/song-detail.fixture.json', async (rel) => {
    // payload 照抄 QQProvider.songDetail；mid 与 tests/unit/qq-mappers.test.ts 同曲（周杰伦《晴天》）
    const payload = {
      comm: { ct: 24, cv: 0 },
      songinfo: {
        module: 'music.pf_song_detail_svr',
        method: 'get_song_detail_yqq',
        param: { song_mid: '003OUlho2HcRHC' },
      },
    }
    const json = await musicuRequest(payload)
    const track = json && json.songinfo && json.songinfo.data && json.songinfo.data.track_info
    if (!track || !track.mid) throw new Error('响应缺 songinfo.data.track_info')
    writeFixture(rel, { endpoint: QQ_MUSICU_URL, method: 'POST', params: payload }, json)
  })

  await run('qq/playlist-cdlist.fixture.json', async (rel) => {
    // dissid 来源：env FLUX_FIXTURE_QQ_DISSID 优先；否则从歌单广场匿名发现一个公开歌单
    let dissid = String(process.env.FLUX_FIXTURE_QQ_DISSID || '').trim()
    if (!dissid) {
      const squareParams = {
        picmid: '1',
        g_tk: '5381',
        loginUin: '0',
        hostUin: '0',
        format: 'json',
        inCharset: 'utf8',
        outCharset: 'utf-8',
        notice: '0',
        platform: 'yqq',
        needNewCode: '0',
        categoryId: '10000000',
        sortId: '5',
        sin: '0',
        ein: '9',
      }
      const su = new URL(QQ_DISS_SQUARE_URL)
      for (const [k, v] of Object.entries(squareParams)) su.searchParams.set(k, v)
      const square = await requestJson(su.toString(), {
        headers: { ...QQ_HEADERS, Referer: 'https://y.qq.com/portal/playlist.html' },
      })
      const list = square && square.data && Array.isArray(square.data.list) ? square.data.list : []
      dissid = String((list[0] && (list[0].dissid || list[0].tid)) || '')
      if (!dissid) throw new Error('歌单广场未返回可用 dissid，可用 FLUX_FIXTURE_QQ_DISSID 手动指定')
      console.log('[record] 从歌单广场发现公开歌单 dissid=' + dissid)
    }
    // 参数照抄 QQProvider.playlistTracks，但匿名 loginUin=0
    const params = {
      type: '1',
      utf8: '1',
      disstid: dissid,
      loginUin: '0',
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq.json',
      needNewCode: '0',
    }
    const u = new URL(QQ_CDLIST_URL)
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
    const json = await requestJson(u.toString(), {
      headers: { ...QQ_HEADERS, Referer: 'https://y.qq.com/n/yqq/playlist' },
    })
    const songlist = json && json.cdlist && json.cdlist[0] && json.cdlist[0].songlist
    if (!Array.isArray(songlist) || !songlist.length) throw new Error('响应缺 cdlist[0].songlist（歌单私有/失效？换 FLUX_FIXTURE_QQ_DISSID 重试）')
    const trimmed = trimAt(json, 'cdlist.0.songlist', 5)
    writeFixture(rel, { endpoint: QQ_CDLIST_URL, method: 'GET', params, trimmed }, json)
  })

  await run('qq/singer-songs.fixture.json', async (rel) => {
    // payload 照抄 QQProvider.artistDetail；num=5 直接控量（周杰伦）
    const payload = {
      comm: { ct: 24, cv: 0 },
      singer: {
        module: 'music.web_singer_info_svr',
        method: 'get_singer_detail_info',
        param: { sort: 5, singermid: '0025NhlN2yWrP4', sin: 0, num: 5 },
      },
    }
    const json = await musicuRequest(payload)
    const songlist = json && json.singer && json.singer.data && json.singer.data.songlist
    if (!Array.isArray(songlist) || !songlist.length) throw new Error('响应缺 singer.data.songlist')
    writeFixture(rel, { endpoint: QQ_MUSICU_URL, method: 'POST', params: payload }, json)
  })
}

// ===== 网易云（与服务端同一 SDK，保证 fixture 与 mapper 输入同构）=====

async function recordNetease() {
  const ncm = require('NeteaseCloudMusicApi')

  await run('netease/cloudsearch.fixture.json', async (rel) => {
    const params = { keywords: '周杰伦 晴天', limit: 5 }
    const r = await ncm.cloudsearch(params)
    const songs = r && r.body && r.body.result && r.body.result.songs
    if (!Array.isArray(songs) || !songs.length) throw new Error('响应缺 result.songs')
    writeFixture(rel, { endpoint: 'NeteaseCloudMusicApi#cloudsearch', method: 'POST', params }, r.body)
  })

  await run('netease/song-detail.fixture.json', async (rel) => {
    // id 与 tests/unit/netease-mappers.test.ts 同曲（周杰伦《晴天》186016）
    const params = { ids: '186016' }
    const r = await ncm.song_detail(params)
    const songs = r && r.body && r.body.songs
    if (!Array.isArray(songs) || !songs.length) throw new Error('响应缺 songs')
    writeFixture(rel, { endpoint: 'NeteaseCloudMusicApi#song_detail', method: 'POST', params }, r.body)
  })

  await run('netease/playlist-tracks.fixture.json', async (rel) => {
    // 3778678 = 云音乐飙升榜（官方榜单，长期稳定公开）
    const params = { id: process.env.FLUX_FIXTURE_NCM_PLAYLIST || '3778678', limit: 5, offset: 0 }
    const r = await ncm.playlist_track_all(params)
    const songs = r && r.body && (r.body.songs || r.body.tracks)
    if (!Array.isArray(songs) || !songs.length) throw new Error('响应缺 songs')
    const trimmed = trimAt(r.body, 'songs', 5)
    writeFixture(rel, { endpoint: 'NeteaseCloudMusicApi#playlist_track_all', method: 'POST', params, trimmed }, r.body)
  })

  await run('netease/personalized.fixture.json', async (rel) => {
    const params = { limit: 5 }
    const r = await ncm.personalized(params)
    const list = r && r.body && r.body.result
    if (!Array.isArray(list) || !list.length) throw new Error('响应缺 result（匿名冷启动可能为空，重试或换时段）')
    writeFixture(rel, { endpoint: 'NeteaseCloudMusicApi#personalized', method: 'POST', params }, r.body)
  })
}

// ===== 天气（参数照抄 src/server/weather/index.ts fetchOpenMeteoWeather；timezone 固定不用 auto）=====

async function recordWeather() {
  await run('weather/open-meteo.fixture.json', async (rel) => {
    const params = {
      latitude: '31.2304',
      longitude: '121.4737',
      current:
        'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m',
      hourly: 'precipitation_probability,weather_code,temperature_2m',
      forecast_days: '1',
      timezone: 'Asia/Shanghai',
    }
    const u = new URL('https://api.open-meteo.com/v1/forecast')
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
    const json = await requestJson(u.toString(), { headers: { 'User-Agent': UA } })
    if (!json || !json.current || json.current.weather_code == null) throw new Error('响应缺 current.weather_code')
    writeFixture(rel, { endpoint: 'https://api.open-meteo.com/v1/forecast', method: 'GET', params }, json)
  })
}

// ===== main =====

const scope = process.argv[2] || 'all'
if (!['qq', 'netease', 'weather', 'all'].includes(scope)) {
  console.error('用法: node scripts/record-fixtures.mjs [qq|netease|weather|all]')
  process.exit(2)
}
if (scope === 'qq' || scope === 'all') await recordQQ()
if (scope === 'netease' || scope === 'all') await recordNetease()
if (scope === 'weather' || scope === 'all') await recordWeather()
if (failed) {
  console.error('[record] 存在失败项（对应 fixture 未写入/未覆盖）')
  process.exitCode = 1
} else {
  console.log('[record] 全部完成')
}
