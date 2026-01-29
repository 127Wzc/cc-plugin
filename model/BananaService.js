import fs from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import { spawn, exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
import Config from '../components/Cfg.js'

const _path = process.cwd()

// 数据目录
const DATA_DIR = path.join(_path, 'data', 'banana')
const KEYS_FILE = path.join(DATA_DIR, 'keys.json')

/**
 * Banana 大香蕉插件服务类
 * 负责配置管理、API 密钥管理、预设管理
 */
class BananaService {
    constructor() {
        this._keysConfig = null
        this._ffmpegAvailable = null  // 缓存 ffmpeg 可用性
    }

    /**
     * 检测 ffmpeg 是否可用（首次调用时检测，结果缓存）
     * @returns {Promise<boolean>}
     */
    async checkFfmpeg() {
        if (this._ffmpegAvailable !== null) {
            return this._ffmpegAvailable
        }

        try {
            await execAsync('ffmpeg -version', { timeout: 5000 })
            this._ffmpegAvailable = true
            logger?.info?.('[Banana] ffmpeg 检测成功，已启用 GIF 首帧提取')
        } catch {
            this._ffmpegAvailable = false
            logger?.warn?.('[Banana] 未检测到 ffmpeg，GIF 图片将不被支持')
        }

        return this._ffmpegAvailable
    }

    /**
     * 使用 ffmpeg 管道提取 GIF 首帧
     * @param {Buffer} gifBuffer - GIF 图片 buffer
     * @returns {Promise<Buffer>} PNG 格式的首帧
     */
    extractGifFirstFrame(gifBuffer) {
        return new Promise((resolve, reject) => {
            const chunks = []
            let finished = false
            let timeoutId = null

            const ffmpeg = spawn('ffmpeg', [
                '-f', 'gif',
                '-i', 'pipe:0',
                '-vframes', '1',
                '-f', 'image2pipe',
                '-vcodec', 'mjpeg',    // 改用 JPEG (体积更小)
                '-q:v', '3',           // JPEG 质量 (1-31, 越小质量越好)
                'pipe:1'
            ])

            const cleanup = () => {
                if (timeoutId) {
                    clearTimeout(timeoutId)
                    timeoutId = null
                }
                // 安全销毁流，避免对已关闭的流操作
                try {
                    if (ffmpeg.stdin && !ffmpeg.stdin.destroyed) ffmpeg.stdin.destroy()
                } catch { }
                try {
                    if (ffmpeg.stdout && !ffmpeg.stdout.destroyed) ffmpeg.stdout.destroy()
                } catch { }
                try {
                    if (ffmpeg.stderr && !ffmpeg.stderr.destroyed) ffmpeg.stderr.destroy()
                } catch { }
                try {
                    if (!ffmpeg.killed) ffmpeg.kill('SIGTERM')
                } catch { }
            }

            const finish = (err, result) => {
                if (finished) return
                finished = true
                cleanup()
                err ? reject(err) : resolve(result)
            }

            // 10秒超时
            timeoutId = setTimeout(() => {
                finish(new Error('ffmpeg 处理超时'))
            }, 10000)

            ffmpeg.stdout.on('data', chunk => chunks.push(chunk))
            ffmpeg.stderr.on('data', () => { })

            ffmpeg.on('close', code => {
                if (code === 0 && chunks.length > 0) {
                    finish(null, Buffer.concat(chunks))
                } else {
                    finish(new Error(`ffmpeg 退出码: ${code}`))
                }
            })

            ffmpeg.on('error', err => finish(new Error(`ffmpeg 错误: ${err.message}`)))

            // 写入数据
            try {
                ffmpeg.stdin.write(gifBuffer)
                ffmpeg.stdin.end()
            } catch (err) {
                finish(new Error(`写入 ffmpeg 失败: ${err.message}`))
            }
        })
    }

    /**
     * 获取插件配置
     */
    get config() {
        return Config.getDefOrConfig('Banana')
    }

    /**
     * 确保数据目录存在
     */
    ensureDataDir() {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true })
        }
    }

    // ==================== 密钥管理 ====================

    /**
     * 获取密钥配置
     */
    getKeysConfig() {
        this.ensureDataDir()

        if (!fs.existsSync(KEYS_FILE)) {
            const defaultConfig = {
                keys: [],
                currentIndex: 0,
                lastUsed: null,
                version: '2.0',
                statistics: {
                    totalRequests: 0,
                    successfulRequests: 0,
                    failedRequests: 0,
                    todayRequests: 0,
                    todayDate: new Date().toDateString()
                }
            }
            fs.writeFileSync(KEYS_FILE, JSON.stringify(defaultConfig, null, 2))
            return defaultConfig
        }

        try {
            const data = fs.readFileSync(KEYS_FILE, 'utf8')
            const config = JSON.parse(data)

            // 检查是否需要重置当日统计
            const today = new Date().toDateString()
            if (config.statistics?.todayDate !== today) {
                config.statistics.todayRequests = 0
                config.statistics.todayDate = today
                this.saveKeysConfig(config)
            }

            return config
        } catch (err) {
            throw new Error('读取密钥配置失败')
        }
    }

    /**
     * 保存密钥配置
     */
    saveKeysConfig(config) {
        this.ensureDataDir()
        fs.writeFileSync(KEYS_FILE, JSON.stringify(config, null, 2))
    }

    /**
     * 获取下一个可用的 API 密钥
     */
    getNextApiKey() {
        const config = this.getKeysConfig()

        if (!config.keys || config.keys.length === 0) {
            throw new Error('没有可用的API密钥，请先使用 #大香蕉添加key 命令添加密钥')
        }

        // 过滤出活跃状态的密钥
        const activeKeys = config.keys.filter(key => key.status === 'active')

        if (activeKeys.length === 0) {
            throw new Error('没有活跃的API密钥，请检查密钥状态或添加新密钥')
        }

        // 找到当前应该使用的密钥
        let currentKey
        if (config.currentIndex >= 0 && config.currentIndex < config.keys.length) {
            const candidateKey = config.keys[config.currentIndex]
            if (candidateKey.status === 'active') {
                currentKey = candidateKey
            }
        }

        // 如果当前索引指向的密钥不可用，找到第一个活跃密钥
        if (!currentKey) {
            currentKey = activeKeys[0]
            config.currentIndex = config.keys.findIndex(key => key.id === currentKey.id)
        }

        // 更新使用统计
        currentKey.lastUsed = new Date().toISOString()
        currentKey.usageCount = (currentKey.usageCount || 0) + 1

        const today = new Date().toDateString()
        if (currentKey.todayDate !== today) {
            currentKey.todayUsage = 0
            currentKey.todayDate = today
        }
        currentKey.todayUsage = (currentKey.todayUsage || 0) + 1

        config.lastUsed = new Date().toISOString()
        config.statistics.totalRequests = (config.statistics.totalRequests || 0) + 1
        config.statistics.todayRequests = (config.statistics.todayRequests || 0) + 1

        // 更新索引到下一个活跃密钥
        const currentActiveIndex = activeKeys.findIndex(key => key.id === currentKey.id)
        const nextActiveIndex = (currentActiveIndex + 1) % activeKeys.length
        const nextActiveKey = activeKeys[nextActiveIndex]
        config.currentIndex = config.keys.findIndex(key => key.id === nextActiveKey.id)

        this.saveKeysConfig(config)

        return currentKey.value
    }

    /**
     * 添加 API 密钥
     */
    addApiKey(keyValue, addedBy = null) {
        const config = this.getKeysConfig()

        // 检查是否已存在
        if (config.keys.some(k => k.value === keyValue)) {
            return { success: false, message: '密钥已存在' }
        }

        const keyObj = {
            id: `key_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            value: keyValue,
            name: `密钥${config.keys.length + 1}`,
            status: 'active',
            addedAt: new Date().toISOString(),
            addedBy: addedBy,
            lastUsed: null,
            usageCount: 0,
            todayUsage: 0,
            todayDate: new Date().toDateString(),
            errorCount: 0,
            todayFailed: 0,
            todayFailedDate: new Date().toDateString(),
            notes: ''
        }

        config.keys.push(keyObj)
        this.saveKeysConfig(config)

        return { success: true, key: keyObj }
    }

    /**
     * 记录密钥使用结果
     */
    recordKeyUsage(keyValue, success, errorMessage = null) {
        try {
            const config = this.getKeysConfig()
            const keyObj = config.keys.find(key => key.value === keyValue)

            if (keyObj) {
                const today = new Date().toDateString()

                if (success) {
                    config.statistics.successfulRequests = (config.statistics.successfulRequests || 0) + 1
                } else {
                    keyObj.errorCount = (keyObj.errorCount || 0) + 1
                    config.statistics.failedRequests = (config.statistics.failedRequests || 0) + 1

                    // 当日失败计数
                    if (keyObj.todayFailedDate !== today) {
                        keyObj.todayFailed = 0
                        keyObj.todayFailedDate = today
                    }
                    keyObj.todayFailed = (keyObj.todayFailed || 0) + 1

                    // 检查是否需要禁用
                    const threshold = this.config.daily_fail_threshold || 10
                    if (this.config.disable_keys_on_error && keyObj.todayFailed >= threshold) {
                        keyObj.status = 'disabled'
                        keyObj.notes = `自动禁用：当日失败${keyObj.todayFailed}次 - ${errorMessage || '未知错误'}`
                    }
                }

                this.saveKeysConfig(config)
            }
        } catch (err) {
            // 静默处理
        }
    }

    /**
     * 重置禁用的密钥
     */
    resetDisabledKeys() {
        const config = this.getKeysConfig()
        let resetCount = 0

        config.keys.forEach(key => {
            if (key.status === 'disabled') {
                key.status = 'active'
                key.todayFailed = 0
                key.todayFailedDate = new Date().toDateString()
                key.notes = `定时重置于 ${new Date().toLocaleString('zh-CN')}`
                resetCount++
            }
        })

        if (resetCount > 0) {
            this.saveKeysConfig(config)
        }

        return resetCount
    }

    // ==================== 预设管理 ====================

    /**
     * 获取预设列表
     */
    getPresets() {
        return this.config.presets || []
    }

    /**
     * 根据命令获取预设
     */
    getPresetByCmd(cmd) {
        const presets = this.getPresets()
        return presets.find(p => p.cmd === cmd)
    }

    /**
     * 获取命令列表（用于动态生成正则）
     */
    getCmdList() {
        const presets = this.getPresets()
        return presets
            .map(p => p.cmd)
            .filter(Boolean)
            .sort((a, b) => b.length - a.length) // 长命令优先
    }

    // ==================== HTTP 请求 ====================

    /**
     * HTTP 请求（无代理）
     */
    httpRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url)
            const isHttps = urlObj.protocol === 'https:'
            const httpModule = isHttps ? https : http

            const enhancedHeaders = {
                'User-Agent': 'Yunzai-Banana-Plugin/1.0.0',
                'Accept': '*/*',
                'Host': urlObj.host,
                'Connection': 'keep-alive',
                ...options.headers
            }

            const requestOptions = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: options.method || 'GET',
                headers: enhancedHeaders,
                timeout: options.timeout || 60000
            }

            const req = httpModule.request(requestOptions, (res) => {
                const chunks = []
                let totalBytes = 0

                res.on('data', chunk => {
                    chunks.push(chunk)
                    totalBytes += chunk.length
                })

                res.on('end', () => {
                    const buffer = Buffer.concat(chunks)
                    const data = buffer.toString()
                    resolve({
                        ok: res.statusCode >= 200 && res.statusCode < 300,
                        status: res.statusCode,
                        statusText: res.statusMessage,
                        headers: res.headers,
                        text: () => Promise.resolve(data),
                        json: () => Promise.resolve(JSON.parse(data)),
                        arrayBuffer: () => Promise.resolve(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
                    })
                })

                res.on('error', reject)
            })

            req.on('error', (err) => {
                const enhancedError = new Error(err.message)
                enhancedError.code = err.code
                enhancedError.errno = err.errno
                reject(enhancedError)
            })

            req.on('timeout', () => {
                reject(new Error('请求超时'))
            })

            if (options.body) {
                req.write(options.body, 'utf8')
            }

            req.end()
        })
    }

    /**
     * 检测 Buffer 是否为 GIF (通过魔数判断)
     * GIF 文件魔数: 47 49 46 38 ("GIF8")
     */
    isGifBuffer(buffer) {
        return buffer.length >= 4 &&
            buffer[0] === 0x47 && buffer[1] === 0x49 &&
            buffer[2] === 0x46 && buffer[3] === 0x38
    }

    /**
     * 下载图片并转换为 base64
     * 如果是 GIF 且系统有 ffmpeg，则提取首帧
     */
    async downloadImageToBase64(imageUrl) {
        const response = await this.httpRequest(imageUrl, {
            method: 'GET',
            timeout: 30000
        })

        if (!response.ok) {
            logger?.error?.(`[Banana] 图片下载失败: HTTP ${response.status} - ${imageUrl}`)
            return null
        }

        let buffer = Buffer.from(await response.arrayBuffer())
        let mimeType = 'image/jpeg'

        // 检测是否为 GIF
        if (this.isGifBuffer(buffer)) {
            if (await this.checkFfmpeg()) {
                try {
                    buffer = await this.extractGifFirstFrame(buffer)
                    mimeType = 'image/jpeg'
                    logger?.debug?.('[Banana] GIF 首帧已提取')
                } catch (err) {
                    logger?.warn?.(`[Banana] 跳过 GIF 图片: 首帧提取失败 - ${err.message}`)
                    return null
                }
            } else {
                logger?.debug?.('[Banana] 跳过 GIF 图片: 需要安装 ffmpeg')
                return null
            }
        } else {
            // 非 GIF: 检测 MIME 类型
            const contentType = response.headers['content-type']
            if (contentType && contentType.startsWith('image/')) {
                mimeType = contentType.split(';')[0]
            } else {
                const ext = imageUrl.split('.').pop()?.toLowerCase()
                switch (ext) {
                    case 'png': mimeType = 'image/png'; break
                    case 'webp': mimeType = 'image/webp'; break
                    default: mimeType = 'image/jpeg'; break
                }
            }
        }

        return `data:${mimeType};base64,${buffer.toString('base64')}`
    }

    /**
     * 批量转换图片为 base64
     */
    async convertImagesToBase64(imageUrls) {
        const results = []
        const errors = []

        for (let i = 0; i < imageUrls.length; i++) {
            try {
                const base64Url = await this.downloadImageToBase64(imageUrls[i])
                if (base64Url) {  // 过滤 null (如被跳过的 GIF)
                    results.push(base64Url)
                }
            } catch (error) {
                errors.push(`图片${i + 1}: ${error.message}`)
                logger.debug(`[Banana] 跳过无效图片: ${imageUrls[i]}`)
            }
        }

        if (results.length === 0 && errors.length > 0) {
            logger?.error?.(`[Banana] 所有图片转换失败: ${errors.join(', ')}`)
        }

        return results
    }
}

export default new BananaService()
