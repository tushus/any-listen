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
  void startExtensionServiceWorker()
  await initModules()
  // 此时扩展已加载、musicList 模块与列表 db 已就绪，自动配置 WEBDAV_SERVERS
  void configureWebDAVFromEnv().catch((error) => appLog.error('WEBDAV_SERVERS configuration failed', error))
  await initRenderers()

  sendInitedEvent()
  appLog.info('app initialized.')
}
