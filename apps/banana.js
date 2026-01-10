import https from 'https'
import http from 'http'
import BananaService from '../model/BananaService.js'
import Render from '../components/Render.js'

// 省略 base64 内容用于日志打印
function omitBase64ForLog(obj, maxLength = 50) {
    if (typeof obj === 'string') {
        if (obj.startsWith('data:image/') && obj.includes(';base64,')) {
            const prefix = obj.substring(0, obj.indexOf(';base64,') + 8)
            const base64Part = obj.substring(obj.indexOf(';base64,') + 8)
            if (base64Part.length > maxLength) {
                return `${prefix}${base64Part.substring(0, maxLength)}... (省略${base64Part.length - maxLength}字符)`
            }
            return obj
        }
        if (obj.length > 100 && /^[A-Za-z0-9+/=]+$/.test(obj)) {
            return `${obj.substring(0, maxLength)}... (省略${obj.length - maxLength}字符)`
        }
        return obj
    }

    if (Array.isArray(obj)) {
        return obj.map(item => omitBase64ForLog(item, maxLength))
    }

    if (obj && typeof obj === 'object') {
        const result = {}
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                result[key] = omitBase64ForLog(obj[key], maxLength)
            }
        }
        return result
    }

    return obj
}

// 任务队列
const taskQueue = []
let runningTasks = 0

function processTaskQueue(maxConcurrent) {
    if (runningTasks >= maxConcurrent || taskQueue.length === 0) {
        return
    }

    const availableSlots = maxConcurrent - runningTasks
    const tasksToRun = Math.min(availableSlots, taskQueue.length)

    for (let i = 0; i < tasksToRun; i++) {
        const task = taskQueue.shift()
        if (task) {
            runningTasks++
                ; (async () => {
                    try {
                        await task.jobFn()
                    } catch (err) {
                        logger?.debug?.('[Banana] 队列任务失败:', err?.message || err)
                    } finally {
                        runningTasks = Math.max(0, runningTasks - 1)
                        processTaskQueue(maxConcurrent)
                    }
                })()
        }
    }
}

function enqueueJob(e, label, jobFn, maxQueue, maxConcurrent) {
    if (taskQueue.length >= maxQueue) {
        e.reply(`❌ 当前任务较多，队列已满（${maxQueue}）。请稍后再试~`)
        return false
    }
    taskQueue.push({ jobFn, label })
    const total = taskQueue.length + runningTasks
    e.reply(`🎨 正在生成[${label}]图片，当前队列 ${total} 个（执行中 ${runningTasks}/${maxConcurrent}），请稍候…`)
    processTaskQueue(maxConcurrent)
    return true
}

// 可用模型列表
const BASE_MODELS = [
    'gemini-2.5-flash-image',
    'gemini-3.0-pro-image',
    'gemini-3-pro-image-preview',
    'imagen-4.0-generate-preview'
]

function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export class banana extends plugin {
    constructor() {
        // 动态生成预设命令正则
        const cmdList = BananaService.getCmdList()
        const presetReg = cmdList.length > 0
            ? `^#(${cmdList.map(escapeRegex).join('|')})(?:\\s+@(\\d+)|\\s+(\\d+))?$`
            : '^#__DISABLED_PRESET__$'

        super({
            name: '[cc-plugin] Banana 大香蕉',
            dsc: '大香蕉图片生成插件',
            event: 'message',
            priority: 200,
            rule: [
                {
                    reg: presetReg,
                    fnc: 'generateImageByPreset'
                },
                {
                    reg: '^#cc.*',
                    fnc: 'generateImage'
                },
                {
                    reg: '^#大香蕉模型列表$',
                    fnc: 'listModels'
                },
                {
                    reg: '^#大香蕉添加key.*',
                    fnc: 'addApiKeys'
                },
                {
                    reg: '^#大香蕉key列表$',
                    fnc: 'listApiKeys'
                },
                {
                    reg: '^#大香蕉调试$',
                    fnc: 'debugBanana'
                },
                {
                    reg: '^#大香蕉预设列表$',
                    fnc: 'listPresets'
                }
            ],
            task: [
                {
                    name: 'Banana密钥重置',
                    cron: '8 0 * * *',
                    fnc: 'resetDisabledKeys'
                }
            ]
        })
    }

    get config() {
        return BananaService.config
    }

    async takeSourceMsg(e, { img, file } = {}) {
        let source = ''
        if (e.getReply) {
            source = await e.getReply()
        } else if (e.source) {
            if (e.group?.getChatHistory) {
                source = (await e.group.getChatHistory(e.source.seq, 1)).pop()
            } else if (e.friend?.getChatHistory) {
                source = (await e.friend.getChatHistory(e.source.time, 1)).pop()
            }
        }
        if (!source) return false
        if (img) {
            let imgArr = []
            for (let i of source.message) {
                if (i.type == 'image') {
                    imgArr.push(i.url)
                }
            }
            return imgArr.length > 0 ? imgArr : false
        }
        if (file) {
            if (source.message[0].type === 'file') {
                let { fid } = source.message[0]
                return fid && e.isGroup ? e?.group?.getFileUrl(fid) : e?.friend?.getFileUrl(fid)
            }
            return false
        }
        return source
    }

    async generateImageByPreset(e) {
        const startTime = Date.now()
        const cmdList = BananaService.getCmdList()
        const cmdRegex = new RegExp(`^#(${cmdList.map(escapeRegex).join('|')})(?:\\s+@(\\d+)|\\s+(\\d+))?$`)
        const match = e.msg.match(cmdRegex)

        if (!match) {
            await e.reply('❌ 预设命令格式错误')
            return
        }

        const cmd = match[1]
        const preset = BananaService.getPresetByCmd(cmd)

        if (!preset) {
            await e.reply(`❌ 未找到预设：${cmd}`)
            return
        }

        const presetName = preset.name || preset.cmd
        const maxQueue = this.config.max_queue || 5
        const maxConcurrent = this.config.max_concurrent || 1

        enqueueJob(e, `${presetName}`, async () => {
            const fullModel = this.config.default_model || 'gemini-3-pro-image-preview'
            await this.performGeneration(e, fullModel, preset.prompt, startTime, false, presetName)
        }, maxQueue, maxConcurrent)
    }

    async generateImage(e) {
        const startTime = Date.now()
        const rawPrompt = e.msg.replace(/^#cc\s*/, '').trim()

        if (!rawPrompt) {
            await e.reply('❌ 请提供提示词\n使用方法：\n#cc [提示词] - 使用默认模型\n例如：#cc 美丽的风景')
            return
        }

        let baseModel = this.config.default_model || 'gemini-3-pro-image-preview'
        let prompt = rawPrompt

        // 检查是否有 -模型名 参数
        for (const model of BASE_MODELS) {
            const modelKeyword = `-${model.replace('gemini-', '').replace('-image', '').replace('imagen-', 'imagen').replace('-generate-preview', '')}`
            const regex = new RegExp(`\\s*${escapeRegex(modelKeyword)}\\s*`, 'i')

            if (regex.test(prompt)) {
                baseModel = model
                prompt = prompt.replace(regex, ' ').trim()
                break
            }
        }

        const maxQueue = this.config.max_queue || 5
        const maxConcurrent = this.config.max_concurrent || 1

        enqueueJob(e, `图片生成`, async () => {
            await this.performGeneration(e, baseModel, prompt, startTime, true)
        }, maxQueue, maxConcurrent)
    }

    // 从响应数据中提取图片 URL
    extractImagesFromData(data, existingUrls = []) {
        const imageUrls = [...existingUrls]
        const hasBase64 = imageUrls.some(url => url.startsWith('data:image/'))

        if (data.images && Array.isArray(data.images)) {
            for (const img of data.images) {
                if (img.type === 'image_url' && img.image_url?.url) {
                    const url = img.image_url.url
                    if (url.startsWith('data:image/')) {
                        if (!hasBase64) imageUrls.push(url)
                    } else if (url.startsWith('http') && !imageUrls.includes(url)) {
                        imageUrls.push(url)
                    }
                }
            }
        }

        if (data.content && typeof data.content === 'string') {
            const content = data.content
            const markdownMatches = [...content.matchAll(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/g)]
            for (const match of markdownMatches) {
                if (!imageUrls.includes(match[1])) imageUrls.push(match[1])
            }
            const urlMatches = [...content.matchAll(/(https?:\/\/[^\s<>")\]]+)/g)]
            for (const match of urlMatches) {
                if (!imageUrls.includes(match[1])) imageUrls.push(match[1])
            }
        }

        return imageUrls
    }

    async performGeneration(e, model, prompt, startTime, isDirectCommand = false, presetName = null) {
        let imageUrls = []
        let hasReplySource = false  // 标记是否使用了引用消息的图片

        // 回复消息中的图片
        const replyImgs = await this.takeSourceMsg(e, { img: true })
        if (Array.isArray(replyImgs) && replyImgs.length > 0) {
            imageUrls.push(...replyImgs)
            hasReplySource = true  // 使用了引用消息
        }

        // 当前消息里的图片
        const currentMsgImgs = e.message
            .filter(m => m.type === 'image' && m.url)
            .map(m => m.url)
        if (currentMsgImgs.length > 0) {
            imageUrls.push(...currentMsgImgs)
        }

        // 预设关键字触发且没有图片，使用用户头像兜底
        if (!isDirectCommand && imageUrls.length === 0) {
            const atSeg = e.message.find(m => m.type === 'at')
            if (atSeg?.qq) {
                const avatar = await this.getAvatarUrl(atSeg.qq)
                if (avatar) imageUrls.push(avatar)
            }

            if (imageUrls.length === 0) {
                const senderAvatar = await this.getAvatarUrl(e.user_id)
                if (senderAvatar) imageUrls.push(senderAvatar)
            }
        }

        // 去重并限制最多 3 张
        if (imageUrls.length > 0) {
            const unique = Array.from(new Set(imageUrls.filter(Boolean)))
            if (unique.length > 3) {
                logger?.debug?.(`[Banana] 输入图片超出3张，已截取前3张`)
            }
            imageUrls = unique.slice(0, 3)
        }

        // 构建消息内容
        let content = []

        if (prompt) {
            content.push({
                type: 'text',
                text: prompt
            })
        }

        if (imageUrls.length > 0) {
            try {
                const base64Images = await BananaService.convertImagesToBase64(imageUrls)
                base64Images.forEach(base64Url => {
                    content.push({
                        type: 'image_url',
                        image_url: { url: base64Url }
                    })
                })
                logger.debug(`[Banana] 成功转换 ${base64Images.length} 张图片为base64`)
            } catch (error) {
                logger.debug(`[Banana] 图片转换失败: ${error.message}`)
                await e.reply(`⚠️ 图片处理失败: ${error.message}\n将继续进行文本生成...`)
            }
        }

        if (content.length === 0) {
            content.push({
                type: 'text',
                text: '生成一个有趣的图片'
            })
        }

        const useStream = this.config.use_stream !== false
        const payload = {
            model: model,
            messages: [{ role: 'user', content: content }],
            stream: useStream
        }

        let currentApiKey = null

        try {
            currentApiKey = BananaService.getNextApiKey()
        } catch (keyError) {
            await e.reply(`❌ ${keyError.message}`)
            return
        }

        const apiUrl = this.config.api_url
        if (!apiUrl) {
            await e.reply('❌ 请先配置 API 服务地址')
            return
        }

        const urlObj = new URL(apiUrl)
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentApiKey}`,
            'User-Agent': 'Yunzai-Banana-Plugin/1.0.0',
            'Accept': '*/*',
            'Host': urlObj.host,
            'Connection': 'keep-alive'
        }

        logger.debug(`[Banana] API 请求 - 地址: ${apiUrl}`)
        logger.debug(`[Banana] API 请求 - 模型: ${model}`)
        logger.debug(`[Banana] API 请求 - 模式: ${useStream ? '流式' : '非流式'}`)

        try {
            let result
            if (useStream) {
                result = await this.streamRequest(apiUrl, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(payload)
                })
            } else {
                result = await this.nonStreamRequest(apiUrl, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(payload)
                })
            }

            if (result.success) {
                BananaService.recordKeyUsage(currentApiKey, true)
                const resultImageUrls = result.imageUrls || (result.imageUrl ? [result.imageUrl] : [])
                if (resultImageUrls.length > 0) {
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
                    const countText = resultImageUrls.length > 1 ? `\n📷 共 ${resultImageUrls.length} 张图片` : ''

                    const replyMsg = resultImageUrls.map(url => segment.image(url))
                    const presetText = presetName ? `\n🎯 预设: ${presetName}` : ''
                    replyMsg.push(`\n✅ 图片生成完成（${elapsed}s）\n🤖 模型: ${model}${presetText}${countText}`)
                    await e.reply(replyMsg, hasReplySource)  // 如果使用了引用消息的图片，则引用回复
                }
            } else {
                throw new Error(result.error)
            }
        } catch (err) {
            BananaService.recordKeyUsage(currentApiKey, false, err?.message)

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
            let errorMsg = `❌ 生成失败（${elapsed}s）`
            errorMsg += `\n错误: ${err.message}`

            if (err.code === 'ECONNRESET' || err.message?.includes('socket hang up')) {
                errorMsg += `\n\n💡 建议: 这通常是网络不稳定或服务器负载过高导致，请稍后再试`
            } else if (err.code === 'ENOTFOUND') {
                errorMsg += `\n\n💡 建议: DNS解析失败，请检查网络连接`
            } else if (err.code === 'ETIMEDOUT') {
                errorMsg += `\n\n💡 建议: 连接超时，请检查网络`
            }

            await e.reply(errorMsg)
        }
    }

    async streamRequest(url, options) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url)
            const isHttps = urlObj.protocol === 'https:'
            const httpModule = isHttps ? https : http

            const requestOptions = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: options.method || 'GET',
                headers: options.headers,
                timeout: 120000
            }

            const req = httpModule.request(requestOptions, (res) => {
                if (res.statusCode !== 200) {
                    const chunks = []
                    res.on('data', chunk => chunks.push(chunk))
                    res.on('end', () => {
                        const errorData = Buffer.concat(chunks).toString()
                        resolve({ success: false, error: `HTTP ${res.statusCode}: ${errorData}` })
                    })
                    return
                }

                let buffer = ''
                let finalImageUrls = []
                let errorMessages = []

                res.on('data', chunk => {
                    const chunkStr = chunk.toString()
                    buffer += chunkStr

                    const lines = buffer.split('\n')
                    buffer = lines.pop()

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6).trim()

                            if (data === '[DONE]') {
                                if (finalImageUrls.length > 0) {
                                    resolve({ success: true, imageUrls: finalImageUrls })
                                } else if (errorMessages.length > 0) {
                                    resolve({ success: false, error: `生成失败: ${errorMessages.join('\n')}` })
                                } else {
                                    resolve({ success: false, error: '未找到生成的内容' })
                                }
                                return
                            }

                            try {
                                const jsonData = JSON.parse(data)

                                if (jsonData.choices?.[0]?.delta?.reasoning_content) {
                                    const reasoning = jsonData.choices[0].delta.reasoning_content
                                    if (reasoning.includes('❌') || reasoning.includes('生成失败')) {
                                        errorMessages.push(reasoning.trim())
                                    }
                                }

                                const delta = jsonData.choices?.[0]?.delta
                                if (delta) {
                                    finalImageUrls = this.extractImagesFromData(delta, finalImageUrls)
                                }
                            } catch (parseErr) {
                                // 忽略解析错误
                            }
                        }
                    }
                })

                res.on('end', () => {
                    if (finalImageUrls.length > 0) {
                        resolve({ success: true, imageUrls: finalImageUrls })
                    } else if (errorMessages.length > 0) {
                        resolve({ success: false, error: `生成失败: ${errorMessages.join('\n')}` })
                    } else {
                        resolve({ success: false, error: '流式响应异常结束' })
                    }
                })

                res.on('error', (err) => {
                    resolve({ success: false, error: `响应流错误: ${err.message}` })
                })
            })

            req.on('error', (err) => {
                let errorMsg = `请求错误: ${err.message}`
                if (err.code) errorMsg += ` (${err.code})`
                resolve({ success: false, error: errorMsg })
            })

            req.on('timeout', () => {
                resolve({ success: false, error: `请求超时 (${requestOptions.timeout}ms)` })
            })

            if (options.body) {
                req.write(options.body, 'utf8')
            }

            req.end()
        })
    }

    async nonStreamRequest(url, options) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url)
            const isHttps = urlObj.protocol === 'https:'
            const httpModule = isHttps ? https : http

            const requestOptions = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: options.method || 'GET',
                headers: options.headers,
                timeout: 180000
            }

            const req = httpModule.request(requestOptions, (res) => {
                if (res.statusCode !== 200) {
                    const chunks = []
                    res.on('data', chunk => chunks.push(chunk))
                    res.on('end', () => {
                        const errorData = Buffer.concat(chunks).toString()
                        resolve({ success: false, error: `HTTP ${res.statusCode}: ${errorData}` })
                    })
                    return
                }

                const chunks = []
                res.on('data', chunk => chunks.push(chunk))

                res.on('end', () => {
                    try {
                        const buffer = Buffer.concat(chunks)
                        const responseText = buffer.toString()
                        const jsonData = JSON.parse(responseText)

                        let finalImageUrls = []
                        if (jsonData.choices?.[0]?.message) {
                            finalImageUrls = this.extractImagesFromData(jsonData.choices[0].message, finalImageUrls)
                        }

                        if (finalImageUrls.length > 0) {
                            resolve({ success: true, imageUrls: finalImageUrls })
                        } else {
                            const errorMsg = jsonData.error?.message || jsonData.message || '未找到生成的内容'
                            resolve({ success: false, error: `生成失败: ${errorMsg}` })
                        }
                    } catch (parseErr) {
                        resolve({ success: false, error: `解析响应失败: ${parseErr.message}` })
                    }
                })

                res.on('error', (err) => {
                    resolve({ success: false, error: `响应错误: ${err.message}` })
                })
            })

            req.on('error', (err) => {
                let errorMsg = `请求错误: ${err.message}`
                if (err.code) errorMsg += ` (${err.code})`
                resolve({ success: false, error: errorMsg })
            })

            req.on('timeout', () => {
                resolve({ success: false, error: `请求超时 (${requestOptions.timeout}ms)` })
            })

            if (options.body) {
                req.write(options.body, 'utf8')
            }

            req.end()
        })
    }

    async getAvatarUrl(qq) {
        return `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=640`
    }

    async listModels(e) {
        const helpGroup = [
            {
                group: '🖼️ 支持的模型',
                list: BASE_MODELS.map(model => ({
                    title: model,
                    desc: model.includes('imagen') ? 'Imagen 图片生成' : 'Gemini 图片生成'
                }))
            }
        ]

        await Render.renderHelp(e, {
            title: '🍌 模型列表',
            subTitle: `当前默认: ${this.config.default_model || 'gemini-3-pro-image-preview'}`,
            helpGroup,
            tips: [
                '#cc [提示词] - 使用默认模型',
                '#cc [提示词] -模型名 - 指定模型'
            ]
        })
        return true // 中断指令响应
    }

    async helpBanana(e) {
        const presets = BananaService.getPresets()

        const helpGroup = [
            {
                group: '📋 基础命令',
                list: [
                    { title: '#cc [提示词]', desc: '生成图片，可回复图片进行图生图' },
                    { title: '#cc帮助', desc: '查看本帮助页面' },
                    { title: '#大香蕉模型列表', desc: '查看支持的模型' },
                    { title: '#大香蕉预设列表', desc: '查看所有预设关键字' }
                ]
            },
            {
                group: '🔧 管理命令 (仅主人)',
                list: [
                    { title: '#大香蕉添加key <密钥>', desc: '添加 API 密钥' },
                    { title: '#大香蕉key列表', desc: '查看密钥状态' },
                    { title: '#大香蕉调试', desc: '查看调试信息' }
                ]
            }
        ]

        // 添加预设列表
        if (presets.length > 0) {
            helpGroup.push({
                group: `🎯 预设关键字 (${presets.length}个)`,
                list: presets.slice(0, 10).map(p => ({
                    title: `#${p.cmd}`,
                    desc: p.desc || p.name || ''
                }))
            })
        }

        await Render.renderHelp(e, {
            title: '🍌 大香蕉帮助',
            subTitle: 'cc-plugin 图片生成插件',
            helpGroup,
            tips: [
                '可以回复图片进行图生图',
                '支持多张图片输入（最多3张）',
                '支持预设关键字快速生成'
            ]
        })
        return true // 中断指令响应
    }

    async debugBanana(e) {
        if (!e.isMaster) { await e.reply('❌ 仅主人可用'); return }

        try {
            const keysConfig = BananaService.getKeysConfig()
            const activeKeys = keysConfig.keys.filter(k => k.status === 'active').length
            const disabledKeys = keysConfig.keys.filter(k => k.status === 'disabled').length

            await e.reply(`🔧 大香蕉插件调试信息
📊 密钥状态: 总计${keysConfig.keys.length}个, 活跃${activeKeys}个, 禁用${disabledKeys}个
📈 请求统计: 总计${keysConfig.statistics?.totalRequests || 0}次
🎯 当前队列: ${taskQueue.length}个任务
⚙️ API地址: ${this.config.api_url || '未配置'}
🤖 默认模型: ${this.config.default_model || 'gemini-3-pro-image-preview'}
📡 流式响应: ${this.config.use_stream !== false ? '启用' : '禁用'}`)
        } catch (err) {
            await e.reply(`❌ 调试失败: ${err.message}`)
        }
    }

    async addApiKeys(e) {
        if (!e.isMaster) { await e.reply('❌ 仅主人可用'); return }

        try {
            const raw = e.msg.slice('#大香蕉添加key'.length).trim()
            if (!raw) {
                await e.reply('❌ 请提供API密钥\n\n📝 使用方法：\n#大香蕉添加key <密钥1> [密钥2] ...')
                return
            }

            const keys = raw.split(/[\s,;，；\n\r]+/).filter(k => k.trim().length > 0)
            if (keys.length === 0) {
                await e.reply('❌ 未检测到有效的API密钥。')
                return
            }

            const addedKeys = []
            const duplicateKeys = []

            for (const key of keys) {
                const result = BananaService.addApiKey(key, e.user_id)
                if (result.success) {
                    addedKeys.push(key.substring(0, 12) + '***')
                } else {
                    duplicateKeys.push(key.substring(0, 12) + '***')
                }
            }

            let reply = `✅ 操作完成:`
            if (addedKeys.length > 0) {
                reply += `\n- 成功添加 ${addedKeys.length} 个新密钥。`
            }
            if (duplicateKeys.length > 0) {
                reply += `\n- 跳过 ${duplicateKeys.length} 个重复密钥。`
            }

            const keysConfig = BananaService.getKeysConfig()
            const activeCount = keysConfig.keys.filter(k => k.status === 'active').length
            reply += `\n\n📊 当前状态：总计 ${keysConfig.keys.length} 个，活跃 ${activeCount} 个`

            await e.reply(reply)
        } catch (err) {
            await e.reply(`❌ 添加密钥失败: ${err.message}`)
        }
    }

    async listApiKeys(e) {
        if (!e.isMaster) { await e.reply('❌ 仅主人可用'); return }

        try {
            const config = BananaService.getKeysConfig()

            if (!config.keys || config.keys.length === 0) {
                await e.reply('📝 当前没有配置任何API密钥\n\n使用 #大香蕉添加key <密钥> 来添加密钥')
                return
            }

            const keyList = config.keys.map((key, index) => {
                const maskedKey = key.value.substring(0, 12) + '***'
                const isCurrent = index === config.currentIndex
                const status = key.status === 'active' ? '✅' : '❌'
                const todayUsage = key.todayUsage || 0
                const todayFailed = key.todayFailed || 0

                return `${index + 1}. ${maskedKey} ${status}${isCurrent ? ' (当前)' : ''} [${todayUsage}|${todayFailed}]`
            }).join('\n')

            const activeCount = config.keys.filter(k => k.status === 'active').length
            const disabledCount = config.keys.filter(k => k.status === 'disabled').length

            await e.reply(`📝 大香蕉 API密钥列表 (${config.keys.length}个)\n\n${keyList}\n\n📊 状态统计: 活跃${activeCount}个, 禁用${disabledCount}个\n📋 格式: [当日用量|当日失败]`)
        } catch (err) {
            await e.reply(`❌ 获取密钥列表失败: ${err.message}`)
        }
    }

    async listPresets(e) {
        try {
            const presets = BananaService.getPresets()
            if (presets.length === 0) {
                await e.reply('📝 当前没有配置任何预设\n\n请在配置文件或 Guoba 面板中添加预设')
                return
            }

            const list = presets.map(p => ({
                title: `#${p.cmd}`,
                desc: p.desc || p.name || ''
            }))

            await Render.renderList(e, {
                title: '🍌 预设列表',
                subTitle: `共 ${presets.length} 个预设`,
                list,
                footer: '💡 回复图片后发送预设关键字即可生成'
            })
            return true // 中断指令响应
        } catch (err) {
            await e.reply(`❌ 预设列表生成失败：${err.message}`)
        }
    }

    async resetDisabledKeys() {
        try {
            const resetCount = BananaService.resetDisabledKeys()
            if (resetCount > 0) {
                logger.info(`[Banana] 定时任务：已重置 ${resetCount} 个失效密钥`)
            } else {
                logger.info('[Banana] 定时任务：没有失效密钥需要重置')
            }
        } catch (err) {
            logger.info('[Banana] 定时任务执行失败:', err.message)
        }
    }
}
