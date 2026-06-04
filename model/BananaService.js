import fs from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
import Config from '../components/Cfg.js'

const _path = process.cwd()

// 数据目录
const DATA_DIR = path.join(_path, 'data', 'banana')

/**
 * Banana 大香蕉插件服务类
 * 负责配置管理、API Key 轮换、预设管理
 */
class BananaService {
    constructor() {
        this._ffmpegAvailable = null  // 缓存 ffmpeg 可用性
        this._configKeyIndex = 0
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
     * 使用 ffmpeg 提取 GIF 首帧 (临时文件方式，更稳定)
     * @param {Buffer} gifBuffer - GIF 图片 buffer
     * @returns {Promise<Buffer>} JPEG 格式的首帧
     */
    async extractGifFirstFrame(gifBuffer) {
        const tmpDir = path.join(DATA_DIR, 'temp')
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true })
        }

        const timestamp = Date.now()
        const inputPath = path.join(tmpDir, `gif_input_${timestamp}.gif`)
        const outputPath = path.join(tmpDir, `gif_output_${timestamp}.jpg`)

        try {
            // 写入临时 GIF 文件
            fs.writeFileSync(inputPath, gifBuffer)

            // 使用 execAsync 执行 ffmpeg
            await execAsync(
                `ffmpeg -y -i "${inputPath}" -vframes 1 -q:v 3 "${outputPath}"`,
                { timeout: 10000 }
            )

            // 读取输出的 JPEG
            const result = fs.readFileSync(outputPath)
            return result
        } finally {
            // 清理临时文件
            try { fs.unlinkSync(inputPath) } catch { }
            try { fs.unlinkSync(outputPath) } catch { }
        }
    }

    /**
     * 获取插件配置
     */
    get config() {
        return Config.getDefOrConfig('Banana')
    }

    /**
     * 获取下一个可用的 API 密钥
     */
    getConfiguredApiKeys() {
        const rawKeys = this.config.api_keys
        const list = Array.isArray(rawKeys) ? rawKeys : []
        const keys = list
            .map(row => {
                if (typeof row === 'string') return row
                if (row && typeof row === 'object') return row.api_key || row.value || row.key
                return ''
            })
            .map(key => String(key || '').trim())
            .filter(Boolean)

        return Array.from(new Set(keys))
    }

    getNextApiKey() {
        const keys = this.getConfiguredApiKeys()

        if (keys.length === 0) {
            throw new Error('没有可用的API密钥，请在锅巴 Banana 绘图配置中填写 API Key')
        }

        const index = this._configKeyIndex % keys.length
        const key = keys[index]
        this._configKeyIndex = (index + 1) % keys.length

        return key
    }

    /**
     * 记录密钥使用结果
     */
    recordKeyUsage(keyValue, success, errorMessage = null) {
        // Banana API Key 现在直接由锅巴配置维护。
        // 失败重试只轮换 key，不记录、不禁用、不清理异常 key。
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
