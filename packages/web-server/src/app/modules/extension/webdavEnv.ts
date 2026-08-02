import { generateId, isUrl } from '@any-listen/common/utils'
import { getAllUserLists, musicListEvent } from '@any-listen/app/modules/musicList'

import { workers } from '@/app/worker'
import { extensionLog } from '@/shared/log4js'

const WEBDAV_EXTENSION_ID = 'internal.webdav'
const WEBDAV_SOURCE = 'webdav'

type EnvEntry = {
  url: string
  username: string
  password: string
  directory: string
  listName: string
  includeSubDir: boolean
  hasDirectory: boolean
}

/**
 * 解析 WEBDAV_SERVERS 环境变量，每行格式：
 * url, username, password[, directory[, listName[, includeSubDir]]]
 * 无效行（缺字段 / 非 URL）打 error 日志后跳过，不影响其它行。
 */
const parseEnvEntries = (value: string): EnvEntry[] => {
  const entries: EnvEntry[] = []
  const token = generateId()
  for (const rawLine of value.trim().split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const parts = line.replaceAll('\\,', token).split(',').map((part) => part.replaceAll(token, ',').trim())
    const [url = '', username = '', password = '', directory = '', listName = '', includeSubDir = ''] = parts
    const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url
    if (!normalizedUrl || !username || !isUrl(normalizedUrl)) {
      extensionLog.error(`WEBDAV_SERVERS: invalid server line ignored: "${line}"`)
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
  return entries
}

/** 解析扩展内 servers 配置（与 internal.webdav 扩展的 parseServersConfig 保持一致的格式） */
const parseStoredServers = (config: string): Array<{ url: string; username: string; password: string }> => {
  const token = generateId()
  return config
    .trim()
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [url = '', username = '', password = ''] = line.replaceAll('\\,', token).split(',').map((part) => part.replaceAll(token, ',').trim())
      return { url: url.endsWith('/') ? url.slice(0, -1) : url, username, password }
    })
}

const escapeComma = (value: string) => value.replaceAll(',', '\\,')

const serializeServers = (servers: Array<{ url: string; username: string; password: string }>) => {
  return servers.map((server) => [server.url, server.username, server.password].map(escapeComma).join(', ')).join('\n')
}

/** 把环境变量中的服务器写入 internal.webdav 扩展的 servers 配置，按 url+username 去重 */
const saveEnvServers = async (entries: EnvEntry[]) => {
  const [stored = ''] = (await workers.extensionService.getExtensionConfigValues(WEBDAV_EXTENSION_ID, ['servers'])) as unknown as [string]
  const servers = parseStoredServers(stored)
  for (const entry of entries) {
    const existing = servers.find((server) => server.url === entry.url && server.username === entry.username)
    if (existing) existing.password = entry.password
    else servers.push({ url: entry.url, username: entry.username, password: entry.password })
  }
  await workers.extensionService.updateExtensionSettings(WEBDAV_EXTENSION_ID, { servers: serializeServers(servers) })
}

/**
 * 为带 directory 字段的条目自动创建 remote 列表。
 * 与网页端手动「添加远程列表」同一条链路：list_create → verifyListCreate → createList → testDir → db → 触发同步。
 * 已存在相同 url+username+directory 的列表时跳过（去重）。
 */
const createRemoteLists = async (entries: EnvEntry[]) => {
  const lists = (await getAllUserLists()).userList
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
        // 与网页端手动创建远程列表时一致的列表基础字段
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
    } catch (error) {
      extensionLog.error(`WEBDAV_SERVERS: create remote list failed: ${entry.url}, ${entry.username}, ${entry.directory}`, error)
    }
  }
}

/** 服务启动后根据 WEBDAV_SERVERS 环境变量自动配置 WebDAV 服务器与远程列表 */
export const configureWebDAVFromEnv = async () => {
  const raw = process.env.WEBDAV_SERVERS?.trim()
  if (!raw) return
  const entries = parseEnvEntries(raw)
  if (!entries.length) return
  try {
    await saveEnvServers(entries)
  } catch (error) {
    extensionLog.error('WEBDAV_SERVERS: failed to write servers config', error)
  }
  await createRemoteLists(entries)
}
