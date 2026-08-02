import { generateId, isUrl } from '@any-listen/common/utils'
import { getAllUserLists, musicListEvent } from '@any-listen/app/modules/musicList'

import { workers } from '@/app/worker'

const LOG_PREFIX = '[WEBDAV_SERVERS]'
const WEBDAV_EXTENSION_ID = 'internal.webdav'
const WEBDAV_SOURCE = 'webdav'

interface EnvEntry {
  url: string
  username: string
  password: string
  directory: string
  listName: string
  includeSubDir: boolean
  hasDirectory: boolean
}

const log = (message: string, error?: unknown) => {
  if (error === undefined) console.log(`${LOG_PREFIX} ${message}`)
  else console.error(`${LOG_PREFIX} ${message}`, error)
}

/** Parse url,username,password[,directory[,listName[,includeSubDir]]. */
const parseEnvEntries = (value: string): { entries: EnvEntry[]; invalid: number } => {
  const entries: EnvEntry[] = []
  let invalid = 0
  const token = generateId()
  for (const rawLine of value.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const parts = line.replaceAll('\\,', token).split(',').map((part) => part.replaceAll(token, ',').trim())
    const [url = '', username = '', password = '', directory = '', listName = '', includeSubDir = ''] = parts
    const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url
    if (!normalizedUrl || !username || !isUrl(normalizedUrl)) {
      invalid++
      log(`忽略无效行: "${line}"`)
      continue
    }
    entries.push({
      url: normalizedUrl,
      username,
      password,
      directory: directory || '/',
      listName,
      includeSubDir: includeSubDir.toLowerCase() === 'true',
      hasDirectory: parts.length >= 4,
    })
  }
  return { entries, invalid }
}

const parseStoredServers = (config: string): Array<{ url: string; username: string; password: string }> => {
  const token = generateId()
  return config
    .trim()
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [url = '', username = '', password = ''] = line
        .replaceAll('\\,', token)
        .split(',')
        .map((part) => part.replaceAll(token, ',').trim())
      return { url: url.endsWith('/') ? url.slice(0, -1) : url, username, password }
    })
}

const escapeComma = (value: string) => value.replaceAll(',', '\\,')
const serializeServers = (servers: Array<{ url: string; username: string; password: string }>) =>
  servers.map((server) => [server.url, server.username, server.password].map(escapeComma).join(', ')).join('\n')

/** Write the extension's persisted `servers` setting (the same key getServers reads). */
const saveEnvServers = async (entries: EnvEntry[]) => {
  const values = (await workers.extensionService.getExtensionConfigValues(WEBDAV_EXTENSION_ID, ['servers'])) as { servers?: string }
  const stored = values.servers ?? ''
  const servers = parseStoredServers(stored)
  let added = 0
  let updated = 0
  let skipped = 0
  for (const entry of entries) {
    const existing = servers.find((server) => server.url === entry.url && server.username === entry.username)
    if (existing) {
      if (existing.password === entry.password) skipped++
      else {
        existing.password = entry.password
        updated++
      }
    } else {
      servers.push({ url: entry.url, username: entry.username, password: entry.password })
      added++
    }
  }
  await workers.extensionService.updateExtensionSettings(WEBDAV_EXTENSION_ID, { servers: serializeServers(servers) })
  log(`写入 servers 成功: 新增 ${added}，更新 ${updated}，跳过重复 ${skipped}（共 ${servers.length} 条）`)
}

const createRemoteLists = async (entries: EnvEntry[]) => {
  const lists = (await getAllUserLists()).userList
  let created = 0
  let skipped = 0
  let failed = 0
  for (const entry of entries) {
    if (!entry.hasDirectory) continue
    if (
      lists.some(
        (list) =>
          list.type === 'remote' &&
          list.meta.extensionId === WEBDAV_EXTENSION_ID &&
          list.meta.source === WEBDAV_SOURCE &&
          list.meta.url === entry.url &&
          list.meta.username === entry.username &&
          list.meta.directory === entry.directory
      )
    ) {
      skipped++
      log(`跳过已存在列表: ${entry.listName || entry.url} (${entry.url}, ${entry.directory})`)
      continue
    }
    const list: AnyListen.List.RemoteListInfo = {
      id: generateId(),
      parentId: null,
      name: entry.listName || new URL(entry.url).hostname || 'WebDAV',
      type: 'remote',
      meta: {
        extensionId: WEBDAV_EXTENSION_ID,
        source: WEBDAV_SOURCE,
        url: entry.url,
        username: entry.username,
        directory: entry.directory,
        includeSubDir: entry.includeSubDir,
        songCount: 0,
        pic: '',
        playCount: 0,
        createTime: 0,
        updateTime: 0,
        posTime: 0,
        desc: '',
        syncTime: 0,
      },
    }
    try {
      await musicListEvent.list_create(-1, [list])
      lists.push(list)
      created++
      log(`创建列表成功: ${list.name} (${entry.url}, ${entry.directory})`)
    } catch (error) {
      failed++
      log(`创建列表失败: ${entry.url}, ${entry.directory}`, error)
    }
  }
  if (created || skipped || failed) log(`列表处理完成: 成功 ${created}，跳过已存在 ${skipped}，失败 ${failed}`)
}

/** Runs after DB, extension host, and music-list initialization. Never blocks app startup. */
export const configureWebDAVFromEnv = async () => {
  const raw = process.env.WEBDAV_SERVERS?.trim()
  if (!raw) return
  try {
    const { entries, invalid } = parseEnvEntries(raw)
    log(`解析完成: 有效条目 ${entries.length} 条，忽略无效行 ${invalid} 条`)
    if (!entries.length) return
    try {
      await saveEnvServers(entries)
    } catch (error) {
      log('写入 servers 失败（启动继续）', error)
    }
    try {
      await createRemoteLists(entries)
    } catch (error) {
      log('列表处理整体失败（启动继续）', error)
    }
  } catch (error) {
    log('自动配置整体失败（启动继续）', error)
  }
}
