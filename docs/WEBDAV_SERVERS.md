# WEBDAV_SERVERS 环境变量自动配置（网页版）

> 本文档适用于 any-listen **网页版（web-server）**。通过一个环境变量 `WEBDAV_SERVERS`，服务启动时自动配置 WebDAV 服务器并创建远程列表，登录网页后即可直接看到列表并播放，无需手动「添加远程列表」。

## 一、功能简介

在部署 any-listen 网页版时，如果希望把 WebDAV 网盘作为音乐库使用，传统做法是：

1. 打开网页登录；
2. 进入「设置 → 扩展 → WebDAV」手动填写服务器地址、账号、密码；
3. 再进入「音乐列表 → 添加远程列表」选择目录创建列表。

这在有持久磁盘的部署中只需做一次，但在 **Render 免费实例、容器重启即清空数据** 的环境中，每次重启都要重来。

`WEBDAV_SERVERS` 环境变量解决了这个问题：**服务每次启动时自动完成以上全部步骤**，且与网页手动添加走的是同一条代码链路（扩展 `servers` 配置 + 音乐列表的远程列表链路），行为完全一致。

## 二、工作原理

服务启动时，在**数据库就绪、扩展宿主就绪、核心模块（含音乐列表 musicList）初始化完成后**自动执行：

```
读取环境变量 WEBDAV_SERVERS
  → 按行解析为服务器条目（无效行跳过并记日志，不影响启动）
  → 写入 internal.webdav 扩展的 servers 配置（按 url+用户名 去重合并）
  → 对带 directory 的条目创建远程列表（与手动添加同链路，重复则跳过）
```

- 每一步单独 try/catch：**任何一条失败只记日志，绝不影响服务启动**。
- 日志统一带 `[WEBDAV_SERVERS]` 前缀。
- 与手动添加完全兼容：配置写入的是扩展设置的 `servers` 字段，列表走的是 `musicList` 的远程列表链路。
- 环境变量未设置或为空（含全空白）时**静默返回，不打印任何日志**。

## 三、环境变量格式

**变量名**：`WEBDAV_SERVERS`

**格式**：每行一个 WebDAV 服务器（或一个目录），字段用英文逗号分隔：

```
url, username, password[, directory[, listName[, includeSubDir]]]
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `url` | ✅ | WebDAV 服务器地址，如 `https://dav.example.com`。末尾的 `/` 会自动去掉（仅去掉一个） |
| `username` | ✅ | 登录用户名 |
| `password` | ✅ | 登录密码 |
| `directory` | ❌ | 要作为音乐目录的路径，默认 `/`（服务器根目录）。**填 4 个及以上字段才会创建远程列表**；只填 3 个字段时只写入服务器配置、不创建列表 |
| `listName` | ❌ | 列表中显示的名称；不填时用 URL 的主机名，再不行用 `WebDAV` |
| `includeSubDir` | ❌ | 是否包含子目录，默认 `false`；值为 `true`（不区分大小写，如 `True`/`TRUE`）时为 `true`，其余值一律为 `false` |

**多服务器**：用换行分隔，每行一个条目；空行会被忽略（不计数）。

**逗号转义**：字段值本身包含逗号时，用 `\,` 转义（如密码 `a,b` 写作 `a\,b`）。写入扩展配置时逗号同样会被转义存储，读取时自动还原。

**字段数细节**：

- 解析时按逗号切分后**去首尾空格**，所以 `url, user, pass` 这种带空格的写法没问题。
- `directory` 是否创建列表只看**字段个数**：`parts.length >= 4` 即创建。即使第 4 个字段留空（如 `url, user, pass, `），也算 4 个字段，会创建根目录 `/` 的列表。
- URL 不是合法地址、或缺少 `url`/`username` 的行视为无效行，跳过并记日志（见「故障排查」）。

### 示例

只配置服务器（不创建列表）：

```
WEBDAV_SERVERS=https://dav.example.com, user1, pass1
```

配置服务器并创建列表（推荐）：

```
WEBDAV_SERVERS=https://dav.example.com, user1, pass1, /music, 我的音乐, true
```

多个服务器、多个目录：

```
WEBDAV_SERVERS=https://dav1.example.com, user1, pass1, /, 网盘A, true
https://dav2.example.com, user2, pass2, /audio, 网盘B, false
```

> 提示：如果列表创建时报 404，通常意味着 `directory` 在服务器上不存在——可以先在浏览器或 curl 里确认该目录真实存在（见「故障排查」）。

## 四、部署配置

### Render 部署

1. 确保服务镜像来自最新代码（含本功能，见「更新说明」）；
2. Render 服务 → Environment → 添加环境变量：
   ```
   WEBDAV_SERVERS=https://dav.example.com, user1, pass1, /music, 我的音乐, true
   ```
3. 保存并重新部署（Manual Deploy → Deploy latest image，或触发自动部署）；
4. 查看日志确认出现 `[WEBDAV_SERVERS] 解析完成` 与 `创建列表成功`。

> Render 免费实例无持久盘：每次重启数据目录被清空，但本功能会在每次启动时自动重建，无需人工干预。

### Docker Compose 部署

```yaml
services:
  any-listen:
    image: ghcr.io/tushus/any-listen:latest
    ports:
      - "9500:9500"
    environment:
      - LOGIN_PWD=your_password
      - WEBDAV_SERVERS=|
          https://dav1.example.com, user1, pass1, /, 网盘A, true
          https://dav2.example.com, user2, pass2, /audio, 网盘B, false
    volumes:
      - ./data:/server/data
```

> 容器内工作目录为 `/server`，数据默认存放在 `/server/data`，因此数据卷应挂载到 `/server/data`（与官方 Docker 部署示例一致）。

### 直接部署（Node.js）

以 `WEBDAV_SERVERS=...` 作为进程环境变量启动即可，其余部署方式与官方文档一致。

## 五、验证步骤

### 1. 日志验证

启动日志应依次出现（数字随配置变化）：

```
[WEBDAV_SERVERS] 解析完成: 有效条目 2 条，忽略无效行 0 条
[WEBDAV_SERVERS] 写入 servers 成功: 新增 2，更新 0，跳过重复 0（共 2 条）
[WEBDAV_SERVERS] 创建列表成功: 网盘A (https://dav1.example.com, /)
[WEBDAV_SERVERS] 创建列表成功: 网盘B (https://dav2.example.com, /audio)
[WEBDAV_SERVERS] 列表处理完成: 成功 2，跳过已存在 0，失败 0
```

各日志含义：

| 日志 | 含义 |
| --- | --- |
| `解析完成: 有效条目 X 条，忽略无效行 Y 条` | 环境变量解析结果；无效行（缺 url/用户名、URL 非法）会被跳过 |
| `写入 servers 成功: 新增 X，更新 Y，跳过重复 Z（共 N 条）` | 写入 internal.webdav 扩展配置；新增=新服务器，更新=密码变化，跳过重复=密码未变；`N` 为合并后的服务器总数 |
| `创建列表成功 / 创建列表失败` | 逐条创建远程列表的结果；失败会附错误详情 |
| `列表处理完成: 成功 X，跳过已存在 Y，失败 Z` | 汇总；仅当发生了创建/跳过/失败（至少一项）时才打印 |

### 2. 网页验证

打开网页 → 登录 → 「音乐列表」中应自动出现配置的远程列表，点击即可浏览与播放 WebDAV 上的音乐文件。

## 六、行为细节（重要）

- **幂等**：重复启动不会产生重复配置——服务器按 `url + 用户名` 去重合并，列表按「`extensionId` + `source` + url + 用户名 + directory」判重（对本功能创建的列表而言即 `url + 用户名 + directory`），已存在则跳过。
- **只增不删**：本功能只负责「新增 / 更新」，不会删除任何已存在的配置。如果从环境变量中移除某行，已保存在扩展配置里的该服务器仍然保留（如需删除，请在网页扩展设置中手动删除）。
- **密码更新**：同一 `url + 用户名` 的密码变了，会自动更新为环境变量中的新值（计入「更新」）；密码相同则跳过（计入「跳过重复」）。
- **每次启动执行**：不依赖持久盘；无论数据目录是否被清空，每次启动都会按环境变量重建/校准。
- **失败不阻塞**：单条服务器或列表失败只记录日志，服务照常启动。
- **与手动配置共存**：手动添加的 WebDAV 服务器/列表不会被破坏，环境变量会与之合并。

## 七、边界与限制

- 本功能**仅作用于网页版（web-server）**，不影响桌面版逻辑。
- 它把 WebDAV 当作**远程音乐库**（走扩展与远程列表链路），**不会**把 WebDAV 挂载为本地目录（无 FUSE/挂载）。
- 与 `ALLOW_PUBLIC_DIR`（本地公开目录）无关，两者是不同机制。
- 列表创建时会校验目录（扩展的 `testDir`），目录不存在会失败并记日志——这与网页手动添加的行为一致。

## 八、故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 日志中完全没有 `[WEBDAV_SERVERS]` 输出 | 镜像版本过旧，不含本功能；**或环境变量未设置/为空**（此时静默不打印任何日志） | 从最新代码重新构建/拉取镜像再部署；确认环境变量已设置且非空 |
| `忽略无效行: "..."` | 该行缺少 url 或用户名，或 url 非法 | 修正该行格式；其它行不受影响 |
| `创建列表失败 ... 404, Not Found` | `directory` 路径在服务器上不存在 | 确认真实路径后修改环境变量（可先用 curl 验证，见下） |
| `创建列表失败 ... 401/403` | 用户名或密码错误 | 检查凭据 |
| 列表已存在但被跳过 | 相同 url+用户名+目录的列表已存在 | 属正常幂等行为，无需处理 |

**验证 WebDAV 目录是否存在的命令**（HTTP 207 = 存在，404 = 不存在）：

```bash
curl -u "用户名:密码" -X PROPFIND "https://服务器地址/目录路径" -H "Depth: 1"
```

**查看服务器根目录下有什么**（帮助确定正确路径）：

```bash
curl -u "用户名:密码" -X PROPFIND "https://服务器地址/" -H "Depth: 1"
```

## 九、更新说明

- 本功能随网页版代码发布，需要镜像包含以下合并：
  - `feat(web): WEBDAV_SERVERS 环境变量自动配置 WebDAV 服务器与远程列表 (#3)`
  - `fix(web): make WEBDAV_SERVERS setup observable and ordered (#4)`
  - `fix(web): preserve WEBDAV_SERVERS runtime lookup (#5)`
- 通过 Docker 镜像（如 `ghcr.io/tushus/any-listen:latest`）部署时，重新拉取/重建镜像后生效。

## 十、实现位置（维护者参考）

- 实现文件：`packages/web-server/src/app/modules/extension/webdavEnv.ts`
- 接入点：`packages/web-server/src/app/index.ts`——在 `startCommonWorkers`（数据库/公共 worker）、`startExtensionServiceWorker`（扩展宿主）、`initModules`（核心模块，含 musicList）之后、`initRenderers` 之前调用 `void configureWebDAVFromEnv().catch(...)`；外层还有一道兜底，失败时记录 `[WEBDAV_SERVERS] configuration failed (startup continues)`，不影响启动。
- 注意：打包器会静态替换字面量 `process.env.XXX`，读取环境变量必须使用动态键 `nodeProcess.env['WEBDAV_SERVERS']` 模式（本实现已遵循，读取代码为 `nodeProcess.env[WEBDAV_SERVERS_ENV_KEY]`）。
