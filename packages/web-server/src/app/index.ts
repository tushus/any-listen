import './shared/error'
import { appState, initAppEnv, sendInitedEvent } from '@/app/app'
import { appLog } from '@/shared/log4js'

import { configureWebDAVFromEnv } from './modules/extension/webdavEnv'
import { initI18n } from './i18n'
import { initModules } from './modules'
import { initRenderers } from './renderer'
import { startCommonWorkers, startExtensionServiceWorker } from './worker'

// let isInited = false
// 初始化应用
export const initApp = async () => {
  console.log('init')
  await initAppEnv()
  initI18n()
  await startCommonWorkers(appState.dataPath)
  // Wait for the extension worker handshake before modules call extension APIs.
  await startExtensionServiceWorker()
  await initModules()
  // DB, extension host, and musicList are ready here. Configuration is best-effort.
  void configureWebDAVFromEnv().catch((error) => appLog.error('[WEBDAV_SERVERS] configuration failed (startup continues)', error))
  await initRenderers()

  sendInitedEvent()
  appLog.info('app initialized.')
}
