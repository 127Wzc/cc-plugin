import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import https from 'https'
import http from 'http'
import Config from '../components/Cfg.js'

const _path = process.cwd()

/**
 * ImgTag API 服务封装类
 * 负责与 ImgTag 智能图床 API 交互及本地索引管理
 */
class ImgTagService {
    constructor() {
        this.indexFile = null
        this.index = null
    }

    /**
     * 获取插件配置
     */
    get config() {
        return Config.getDefOrConfig('ImgTag')
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
     * 通用 API 请求方法
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

    /**
     * 获取图片详情
     * @param {number} imageId - 图片 ID
     * @returns {Promise<object>}
     */
    async getImageDetail(imageId) {
        return this.apiRequest(`/images/${imageId}`)
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
