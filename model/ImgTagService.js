import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import https from 'https'
import http from 'http'
import Config from '../components/Cfg.js'

const _path = process.cwd()
const MASKED_KEY_PLACEHOLDER = '******'

/**
 * ImgTag API 服务封装类
 * 负责与 ImgTag 智能图床 API 交互及本地索引管理
 */
class ImgTagService {
    constructor() {
        this.indexFile = null
        this.index = null
        this._userKeys = null
        this._readKeyCursor = 0
    }

    /**
     * 获取插件配置
     */
    get config() {
        return Config.getDefOrConfig('ImgTag')
    }

    /**
     * 插件数据目录
     */
    get pluginDataDir() {
        return path.join(_path, 'plugins', 'cc-plugin', 'data')
    }

    /**
     * 用户自助 key 存储文件（不进 YAML/Guoba）
     */
    get userKeysPath() {
        return path.join(this.pluginDataDir, 'imgtag_user_keys.json')
    }

    /**
     * 获取用户配置（仅 config/ 目录，便于保留真实 key）
     */
    get rawConfig() {
        try {
            return Config.getConfig('ImgTag') || {}
        } catch {
            return {}
        }
    }

    /**
     * 判断是否为主人
     */
    isMaster(userId) {
        const uid = String(userId || '')
        return Array.isArray(Config.masterQQ) && Config.masterQQ.map(String).includes(uid)
    }

    /**
     * 是否授权使用 ImgTag（主人/allowed_users/user_keys enabled）
     */
    isAllowedUser(userId) {
        const uid = String(userId || '')
        if (!uid) return false
        if (this.isMaster(uid)) return true

        const allowed = Array.isArray(this.config.allowed_users) ? this.config.allowed_users.map(String) : []
        if (allowed.includes(uid)) return true

        const userKeys = Array.isArray(this.config.user_keys) ? this.config.user_keys : []
        return userKeys.some(item => String(item?.user_id) === uid && item?.enabled !== false)
    }

    // ==================== 用户 Key 管理 ====================

    loadUserKeys() {
        if (this._userKeys) return this._userKeys
        try {
            if (!fs.existsSync(this.pluginDataDir)) {
                fs.mkdirSync(this.pluginDataDir, { recursive: true })
            }
            if (!fs.existsSync(this.userKeysPath)) {
                this._userKeys = {}
                fs.writeFileSync(this.userKeysPath, JSON.stringify(this._userKeys, null, 2), 'utf8')
                return this._userKeys
            }
            const raw = fs.readFileSync(this.userKeysPath, 'utf8')
            this._userKeys = raw ? JSON.parse(raw) : {}
        } catch (err) {
            logger.warn?.(`[ImgTag] 加载用户 key 失败: ${err?.message || err}`)
            this._userKeys = {}
        }
        return this._userKeys
    }

    saveUserKeys() {
        try {
            if (!fs.existsSync(this.pluginDataDir)) {
                fs.mkdirSync(this.pluginDataDir, { recursive: true })
            }
            fs.writeFileSync(this.userKeysPath, JSON.stringify(this._userKeys || {}, null, 2), 'utf8')
        } catch (err) {
            logger.warn?.(`[ImgTag] 保存用户 key 失败: ${err?.message || err}`)
        }
    }

    setUserApiKey(userId, apiKey) {
        const uid = String(userId || '')
        if (!uid) throw new Error('无效的用户 ID')
        const key = String(apiKey || '').trim()
        if (!key || key === MASKED_KEY_PLACEHOLDER) throw new Error('无效的 api_key')
        const data = this.loadUserKeys()
        data[uid] = { api_key: key, updated_at: Date.now() }
        this._userKeys = data
        this.saveUserKeys()
        return true
    }

    deleteUserApiKey(userId) {
        const uid = String(userId || '')
        if (!uid) throw new Error('无效的用户 ID')
        const data = this.loadUserKeys()
        if (data[uid]) {
            delete data[uid]
            this._userKeys = data
            this.saveUserKeys()
        }
        return true
    }

    /**
     * 从 Guoba/YAML 关联中取 key（优先）
     */
    getUserApiKeyFromConfig(userId) {
        const uid = String(userId || '')
        if (!uid) return null
        const userKeys = Array.isArray(this.config.user_keys) ? this.config.user_keys : []
        const row = userKeys.find(item => String(item?.user_id) === uid && item?.enabled !== false)
        const key = String(row?.api_key || '').trim()
        return key ? key : null
    }

    /**
     * 从用户自助 JSON 中取 key（次级）
     */
    getUserApiKeyFromData(userId) {
        const uid = String(userId || '')
        if (!uid) return null
        const data = this.loadUserKeys()
        const key = String(data?.[uid]?.api_key || '').trim()
        return key ? key : null
    }

    /**
     * 获取用户 api_key：Guoba/YAML 优先，其次自助 JSON
     */
    getUserApiKey(userId) {
        return this.getUserApiKeyFromConfig(userId) || this.getUserApiKeyFromData(userId)
    }

    /**
     * 获取本次 API 请求应该使用的 key
     * - 授权用户：必须有个人 key
     * - 主人：若无个人 key，允许使用全局 key
     */
    getApiKeyForUser(userId) {
        const uid = String(userId || '')
        if (!uid) return null
        const personal = this.getUserApiKey(uid)
        if (personal) return personal
        if (this.isMaster(uid)) {
            const globalKey = String(this.config.api_key || '').trim()
            return globalKey || null
        }
        return null
    }

    getKeySource(userId) {
        const uid = String(userId || '')
        if (!uid) return 'none'
        if (this.getUserApiKeyFromConfig(uid)) return 'guoba'
        if (this.getUserApiKeyFromData(uid)) return 'self'
        if (this.isMaster(uid) && String(this.config.api_key || '').trim()) return 'global'
        return 'none'
    }

    /**
     * 获取本地存储根路径
     */
    get localPath() {
        return path.join(_path, this.config.local_path || './resources/imgtag')
    }

    /**
     * 获取索引文件路径
     */
    get indexPath() {
        return path.join(this.localPath, 'index.json')
    }

    /**
     * 加载本地索引
     */
    loadIndex() {
        if (this.index) return this.index

        try {
            if (fs.existsSync(this.indexPath)) {
                this.index = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'))
            } else {
                this.index = {}
            }
        } catch (error) {
            logger.error(`[ImgTag] 加载索引失败: ${error}`)
            this.index = {}
        }
        return this.index
    }

    /**
     * 保存本地索引
     */
    saveIndex() {
        try {
            // 确保目录存在
            if (!fs.existsSync(this.localPath)) {
                fs.mkdirSync(this.localPath, { recursive: true })
            }
            fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2), 'utf8')
        } catch (error) {
            logger.error(`[ImgTag] 保存索引失败: ${error}`)
        }
    }

    /**
     * 更新索引项
     * @param {string} md5 - 文件 MD5
     * @param {object} metadata - 元数据 {ext, remote_id, url, synced}
     */
    updateIndex(md5, metadata) {
        this.loadIndex()
        this.index[md5] = { ...this.index[md5], ...metadata, updated_at: Date.now() }
        this.saveIndex()
    }

    /**
     * 获取本地文件路径 (直接存储到根目录，用 MD5 命名)
     * 格式: /{md5}.{ext}
     * @param {string} md5 - 文件 MD5
     * @param {string} ext - 文件扩展名
     */
    getLocalFilePath(md5, ext) {
        return path.join(this.localPath, `${md5}.${ext}`)
    }

    /**
     * 检查本地是否存在该文件
     * @param {string} md5 - 文件 MD5
     */
    existsLocal(md5) {
        this.loadIndex()
        if (!this.index[md5]) return false

        const filePath = this.getLocalFilePath(md5, this.index[md5].ext)
        return fs.existsSync(filePath)
    }

    /**
     * 从索引中查找本地文件路径
     * @param {string} md5 - 文件 MD5
     * @returns {string|null} 本地文件路径或 null
     */
    findLocalPath(md5) {
        this.loadIndex()
        const meta = this.index[md5]
        if (!meta) return null

        const filePath = this.getLocalFilePath(md5, meta.ext)
        return fs.existsSync(filePath) ? filePath : null
    }

    /**
     * 下载图片并计算 MD5
     * @param {string} url - 图片 URL
     * @returns {Promise<{buffer: Buffer, md5: string, ext: string}>}
     */
    downloadAndHash(url) {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http

            protocol.get(url, (res) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`下载失败，状态码: ${res.statusCode}`))
                    return
                }

                const chunks = []
                const contentType = res.headers['content-type'] || 'image/jpeg'
                let ext = contentType.split('/')[1] || 'jpg'
                // 处理特殊类型
                if (ext === 'jpeg') ext = 'jpg'
                if (ext.includes(';')) ext = ext.split(';')[0]

                res.on('data', chunk => chunks.push(chunk))
                res.on('end', () => {
                    const buffer = Buffer.concat(chunks)
                    const md5 = crypto.createHash('md5').update(buffer).digest('hex')
                    resolve({ buffer, md5, ext })
                })
                res.on('error', reject)
            }).on('error', reject)
        })
    }

    /**
     * 保存图片到本地
     * @param {string} url - 图片 URL
     * @returns {Promise<{md5: string, ext: string, localPath: string, isNew: boolean}>}
     */
    async saveLocal(url) {
        const { buffer, md5, ext } = await this.downloadAndHash(url)

        // 检查是否已存在
        if (this.existsLocal(md5)) {
            logger.info(`[ImgTag] 图片已存在: ${md5}`)
            return { md5, ext, localPath: this.getLocalFilePath(md5, ext), isNew: false }
        }

        // 创建目录
        const filePath = this.getLocalFilePath(md5, ext)
        const dir = path.dirname(filePath)
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
        }

        // 写入文件
        fs.writeFileSync(filePath, buffer)
        logger.info(`[ImgTag] 保存本地: ${filePath}`)

        // 更新索引
        this.updateIndex(md5, { ext, synced: false })

        return { md5, ext, localPath: filePath, isNew: true }
    }

    /**
     * 从 URL 中尝试提取 MD5
     * ImgTag 的 URL 格式通常为: .../xx/yy/md5.ext
     * @param {string} url - 图片 URL
     * @returns {string|null}
     */
    extractMd5FromUrl(url) {
        try {
            const pathname = new URL(url).pathname
            const filename = path.basename(pathname)
            const name = filename.split('.')[0]
            // MD5 是 32 位十六进制
            if (/^[a-f0-9]{32}$/i.test(name)) {
                return name.toLowerCase()
            }
        } catch (e) {
            // 忽略解析错误
        }
        return null
    }

    // ==================== API 方法 ====================

    /**
     * 通用 API 请求方法（全局 key）
     */
    async apiRequest(endpoint, method = 'GET', body = null) {
        const { api_url, api_key } = this.config

        if (!api_url || !api_key) {
            throw new Error('请先配置 api_url 和 api_key')
        }

        const url = `${api_url}/api/v1/external${endpoint}`
        const headers = {
            'api_key': api_key,
            'Content-Type': 'application/json'
        }

        const options = { method, headers }
        if (body) {
            options.body = JSON.stringify(body)
        }

        // 动态导入 fetch
        const fetch = (await import('node-fetch')).default
        const response = await fetch(url, options)

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`API 请求失败 [${response.status}]: ${errorText}`)
        }

        return response.json()
    }

    /**
     * 按用户 key 请求 API
     */
    async apiRequestForUser(userId, endpoint, method = 'GET', body = null) {
        const api_url = String(this.config.api_url || '').trim()
        if (!api_url) throw new Error('请先配置 api_url')

        const api_key = this.getApiKeyForUser(userId)
        if (!api_key) throw new Error('未配置个人 api_key，请先设置后再使用')

        const url = `${api_url}/api/v1/external${endpoint}`
        const headers = {
            'api_key': api_key,
            'Content-Type': 'application/json'
        }
        const options = { method, headers }
        if (body) options.body = JSON.stringify(body)

        const fetch = (await import('node-fetch')).default
        const response = await fetch(url, options)
        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`API 请求失败 [${response.status}]: ${errorText}`)
        }
        return response.json()
    }

    /**
     * 使用指定 api_key 请求（用于公共读：搜图/随机图）
     */
    async apiRequestWithKey(apiKey, endpoint, method = 'GET', body = null) {
        const api_url = String(this.config.api_url || '').trim()
        if (!api_url) throw new Error('请先配置 api_url')

        const key = String(apiKey || '').trim()
        if (!key) throw new Error('未配置可用的 ImgTag api_key')

        const url = `${api_url}/api/v1/external${endpoint}`
        const headers = {
            'api_key': key,
            'Content-Type': 'application/json'
        }
        const options = { method, headers }
        if (body) options.body = JSON.stringify(body)

        const fetch = (await import('node-fetch')).default
        const response = await fetch(url, options)
        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`API 请求失败 [${response.status}]: ${errorText}`)
        }
        return response.json()
    }

    /**
     * 获取一个“可用于公共读”的 key
     * 优先：全局 api_key；否则从 ImgTag.user_keys（Guoba 管理）里轮询取一个
     */
    getAnyReadApiKey() {
        const globalKey = String(this.config.api_key || '').trim()
        if (globalKey) return globalKey

        const pool = (Array.isArray(this.config.user_keys) ? this.config.user_keys : [])
            .filter(row => row?.enabled !== false)
            .map(row => String(row?.api_key || '').trim())
            .filter(k => k && k !== MASKED_KEY_PLACEHOLDER)

        if (pool.length === 0) return null

        const idx = Math.abs(this._readKeyCursor) % pool.length
        this._readKeyCursor = (this._readKeyCursor + 1) % 1000000
        return pool[idx]
    }

    /**
     * 上传图片到云端
     * @param {string} imageUrl - 原始图片 URL
     * @param {string[]} tags - 标签列表
     * @param {string} description - 描述
     * @param {string} callbackUrl - 分析完成后的回调 URL
     * @returns {Promise<object>} API 响应
     */
    async addImage(imageUrl, tags = [], description = '', callbackUrl = null) {
        const body = {
            image_url: imageUrl,
            auto_analyze: this.config.auto_analyze !== false
        }

        if (tags.length > 0) {
            body.tags = tags
        }
        if (description) {
            body.description = description
        }
        if (this.config.default_category_id) {
            body.category_id = this.config.default_category_id
        }
        if (callbackUrl) {
            body.callback_url = callbackUrl
        }

        return this.apiRequest('/images', 'POST', body)
    }

    async addImageForUser(userId, imageUrl, tags = [], description = '', callbackUrl = null) {
        const body = {
            image_url: imageUrl,
            auto_analyze: this.config.auto_analyze !== false
        }
        if (tags.length > 0) body.tags = tags
        if (description) body.description = description
        if (this.config.default_category_id) body.category_id = this.config.default_category_id
        if (callbackUrl) body.callback_url = callbackUrl
        return this.apiRequestForUser(userId, '/images', 'POST', body)
    }

    /**
     * 搜索图片
     * @param {string} keyword - 关键词
     * @param {string[]} tags - 标签列表
     * @param {number} limit - 返回数量
     * @returns {Promise<object>}
     */
    async searchImages(keyword = '', tags = [], limit = null) {
        const params = new URLSearchParams()

        if (keyword) params.append('keyword', keyword)
        if (tags.length > 0) {
            tags.forEach(tag => params.append('tags', tag))
        }
        params.append('limit', limit || this.config.search_limit || 20)

        return this.apiRequest(`/images/search?${params.toString()}`)
    }

    async searchImagesForUser(userId, keyword = '', tags = [], limit = null) {
        const params = new URLSearchParams()
        if (keyword) params.append('keyword', keyword)
        if (tags.length > 0) tags.forEach(tag => params.append('tags', tag))
        params.append('limit', limit || this.config.search_limit || 20)
        return this.apiRequestForUser(userId, `/images/search?${params.toString()}`)
    }

    async searchImagesPublic(keyword = '', tags = [], limit = null) {
        const key = this.getAnyReadApiKey()
        if (!key) throw new Error('管理员未配置可用的 ImgTag api_key')

        const params = new URLSearchParams()
        if (keyword) params.append('keyword', keyword)
        if (tags.length > 0) tags.forEach(tag => params.append('tags', tag))
        params.append('limit', limit || this.config.search_limit || 20)

        return this.apiRequestWithKey(key, `/images/search?${params.toString()}`)
    }

    /**
     * 获取随机图片
     * @param {string[]} tags - 标签过滤
     * @param {number} count - 返回数量
     * @returns {Promise<object>}
     */
    async getRandomImages(tags = [], count = null) {
        const params = new URLSearchParams()

        if (tags.length > 0) {
            tags.forEach(tag => params.append('tags', tag))
        }
        params.append('count', count || this.config.random_count || 1)

        return this.apiRequest(`/images/random?${params.toString()}`)
    }

    async getRandomImagesForUser(userId, tags = [], count = null) {
        const params = new URLSearchParams()
        if (tags.length > 0) tags.forEach(tag => params.append('tags', tag))
        params.append('count', count || this.config.random_count || 1)
        return this.apiRequestForUser(userId, `/images/random?${params.toString()}`)
    }

    async getRandomImagesPublic(tags = [], count = null) {
        const key = this.getAnyReadApiKey()
        if (!key) throw new Error('管理员未配置可用的 ImgTag api_key')

        const params = new URLSearchParams()
        if (tags.length > 0) tags.forEach(tag => params.append('tags', tag))
        params.append('count', count || this.config.random_count || 1)

        return this.apiRequestWithKey(key, `/images/random?${params.toString()}`)
    }

    /**
     * 获取图片详情
     * @param {number} imageId - 图片 ID
     * @returns {Promise<object>}
     */
    async getImageDetail(imageId) {
        return this.apiRequest(`/images/${imageId}`)
    }

    async getImageDetailForUser(userId, imageId) {
        return this.apiRequestForUser(userId, `/images/${imageId}`)
    }

    /**
     * 智能获取图片发送路径 (本地优先)
     * @param {object} image - API 返回的图片对象 {url, ...}
     * @returns {string} 可用于 segment.image 的路径
     */
    getImagePath(image) {
        const strategy = this.config.send_strategy || 'local_first'
        const remoteUrl = image.url || image.image_url

        if (strategy === 'remote_only') {
            return remoteUrl
        }

        // 尝试从 URL 提取 MD5
        const md5 = this.extractMd5FromUrl(remoteUrl)
        if (md5) {
            const localPath = this.findLocalPath(md5)
            if (localPath) {
                logger.debug(`[ImgTag] 使用本地文件: ${localPath}`)
                return `file://${localPath}`
            }
        }

        if (strategy === 'local_only') {
            return null // 本地不存在则返回 null
        }

        // local_first: 本地不存在则使用远程
        return remoteUrl
    }

    /**
     * 获取本地统计信息
     */
    getStats() {
        this.loadIndex()
        const total = Object.keys(this.index).length
        const synced = Object.values(this.index).filter(v => v.synced).length
        return { total, synced, unsynced: total - synced }
    }

    /**
     * 获取云端 Dashboard 统计（无需密钥）
     * @returns {Promise<object>} Dashboard 数据
     */
    async getDashboard() {
        const { api_url } = this.config
        if (!api_url) {
            throw new Error('请先配置 api_url')
        }

        const url = `${api_url}/api/v1/system/dashboard`
        const fetch = (await import('node-fetch')).default
        const response = await fetch(url)

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`获取统计失败 [${response.status}]: ${errorText}`)
        }

        return response.json()
    }
}

export default new ImgTagService()
