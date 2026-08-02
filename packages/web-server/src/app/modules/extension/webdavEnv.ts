import { generateId, isUrl } from '@any-listen/common/utils'
import { getAllUserLists, musicListEvent } from '@any-listen/app/modules/musicList'

import { workers } from '@/app/worker'
import { extensionLog } from '@/shared/log4js'

type Entry = { url: string; username: string; password: string; directory?: string; listName?: string; includeSubDir: boolean; hasDirectory: boolean }
const parse = (value: string): Entry[] => {
  const token = generateId()
  return value.trim().split('\n').filter((line) => line.trim()).map((line) => {
    const parts = line.trim().replaceAll('\\,', token).split(',').map((part) => part.replaceAll(token, ',').trim())
    const [url = '', username = '', password = '', directory, listName, includeSubDir] = parts
    return { url: url.endsWith('/') ? url.slice(0, -1) : url, username, password, directory: directory || '/', listName, includeSubDir: includeSubDir?.toLowerCase() === 'true', hasDirectory: parts.length >= 4 }
  }).filter((entry) => entry.url && entry.username && entry.password && isUrl(entry.url))
}

export const configureWebDAVFromEnv = async () => {
  const raw = process.env.WEBDAV_SERVERS?.trim()
  if (!raw) return
  const entries = parse(raw)
  if (!entries.length) return
  try {
    const values = (await workers.extensionService.getExtensionConfigValues('internal.webdav', ['servers'])) as [string]
    const token = generateId()
    const servers = (values[0] || '').trim().split('\n').filter(Boolean).map((line) => {
      const [url = '', username = '', password = ''] = line.replaceAll('\\,', token).split(',').map((part) => part.replaceAll(token, ',').trim())
      return { url: url.endsWith('/') ? url.slice(0, -1) : url, username, password }
    })
    for (const entry of entries) {
      const existing = servers.find((server) => server.url === entry.url && server.username === entry.username)
      if (existing) existing.password = entry.password
      else servers.push({ url: entry.url, username: entry.username, password: entry.password })
    }
    await workers.extensionService.updateExtensionSettings('internal.webdav', { servers: servers.map((s) => `${s.url}, ${s.username}, ${s.password}`).join('\n') })
  } catch (error) { extensionLog.error('WebDAV environment server configuration failed', error) }

  const lists = getAllUserLists().userList
  for (const entry of entries) {
    if (!entry.hasDirectory) continue
    if (lists.some((list) => list.type === 'remote' && list.meta.extensionId === 'internal.webdav' && list.meta.source === 'webdav' && list.meta.url === entry.url && list.meta.username === entry.username && list.meta.directory === entry.directory)) continue
    try {
      const list: AnyListen.List.RemoteListInfo = { id: generateId(), parentId: null, name: entry.listName || new URL(entry.url).hostname || 'WebDAV', type: 'remote', meta: { extensionId: 'internal.webdav', source: 'webdav', url: entry.url, username: entry.username, directory: entry.directory || '/', includeSubDir: entry.includeSubDir, syncTime: 0 } }
      await musicListEvent.list_create(-1, [list])
      lists.push(list)
    } catch (error) { extensionLog.error(`WebDAV environment list ${entry.url} failed`, error) }
  }
}
