import https from 'https'
import http from 'http'
import BananaService from '../model/BananaService.js'
import Render from '../components/Render.js'
import Config from '../components/Cfg.js'

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

function enqueueJob(e, label, jobFn, maxQueue, maxConcurrent, { kind = '图片', emoji = '🎨' } = {}) {
    if (taskQueue.length >= maxQueue) {
        e.reply(`❌ 当前任务较多，队列已满（${maxQueue}）。请稍后再试~`, true)
        return false
    }
    taskQueue.push({ jobFn, label })
    const total = taskQueue.length + runningTasks
    e.reply(`${emoji} 正在生成[${label}]${kind}，当前队列 ${total} 个（执行中 ${runningTasks}/${maxConcurrent}），请稍候…`, true)
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
                    reg: '^#cc切换图片模型\\s*.+$',
                    fnc: 'switchImageModel',
                    permission: 'master'
                },
                {
                    reg: '^#cc切换视频模型\\s*.+$',
                    fnc: 'switchVideoModel',
                    permission: 'master'
                },
                {
                    reg: '^#cc视频.*',
                    fnc: 'generateVideo'
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

        const presetCmd = preset.cmd  // 使用触发指令而不是名称
        const maxQueue = this.config.max_queue || 5
        const maxConcurrent = this.config.max_concurrent || 1

        enqueueJob(e, `#${presetCmd}`, async () => {
            const fullModel = this.config.default_model || 'gemini-3-pro-image-preview'
            await this.performGeneration(e, fullModel, preset.prompt, startTime, false, `#${presetCmd}`)
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
        }, maxQueue, maxConcurrent, { kind: '图片', emoji: '🎨' })
    }

    // 从响应数据中提取图片 URL
    extractImagesFromData(data, existingUrls = []) {
        const imageUrls = [...existingUrls]

        const addImageUrl = url => {
            if (!url || typeof url !== 'string') return
            const normalized = url.startsWith('data:image/')
                ? url.replace(/\s+/g, '')
                : url.trim()
            if (!normalized) return
            if (normalized.startsWith('data:image/')) {
                if (!imageUrls.some(item => item.startsWith('data:image/'))) imageUrls.push(normalized)
            } else if (normalized.startsWith('http') && !imageUrls.includes(normalized)) {
                imageUrls.push(normalized)
            }
        }

        // OpenAI 标准：content 可能是数组（多模态分段）
        const extractFromContentParts = parts => {
            if (!Array.isArray(parts)) return
            for (const part of parts) {
                if (!part || typeof part !== 'object') continue
                if (part.type === 'image_url' && part.image_url?.url) {
                    addImageUrl(part.image_url.url)
                    continue
                }
                if (typeof part.url === 'string') {
                    // 兼容部分后端直接给 url 字段
                    addImageUrl(part.url)
                }
            }
        }

        if (Array.isArray(data)) {
            extractFromContentParts(data)
            return imageUrls
        }

        if (data.images && Array.isArray(data.images)) {
            for (const img of data.images) {
                if (img.type === 'image_url' && img.image_url?.url) {
                    addImageUrl(img.image_url.url)
                }
            }
        }

        if (data.content && Array.isArray(data.content)) {
            extractFromContentParts(data.content)
        }

        if (data.content && typeof data.content === 'string') {
            const content = data.content
            const markdownMatches = [...content.matchAll(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/g)]
            for (const match of markdownMatches) {
                const url = match[1]
                if (/\.(mp4|webm|mov|m4v|mkv)(\?|#|$)/i.test(url)) continue
                addImageUrl(url)
            }
            const dataMarkdownMatches = [...content.matchAll(/!\[.*?\]\((data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+)\)/gi)]
            for (const match of dataMarkdownMatches) {
                addImageUrl(match[1])
            }
            const urlMatches = [...content.matchAll(/(https?:\/\/[^\s<>")\]]+)/g)]
            for (const match of urlMatches) {
                const url = match[1]
                // 避免把视频链接当图片链接
                if (/\.(mp4|webm|mov|m4v|mkv)(\?|#|$)/i.test(url)) continue
                addImageUrl(url)
            }
            const dataUrlMatches = [...content.matchAll(/(data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+)/gi)]
            for (const match of dataUrlMatches) {
                addImageUrl(match[1])
            }
        }

        return imageUrls
    }

    // 从响应数据中提取视频 URL（尽量兼容不同后端返回结构）
    extractVideosFromData(data, existingUrls = []) {
        const videoUrls = [...existingUrls]

        const addUrl = url => {
            if (!url || typeof url !== 'string') return
            const trimmed = url.trim()
            if (!trimmed) return
            if (!videoUrls.includes(trimmed)) videoUrls.push(trimmed)
        }

        if (!data) return videoUrls

        // 结构化字段（兼容 video_url / videos / video 等）
        const extractFromContentParts = parts => {
            if (!Array.isArray(parts)) return
            for (const part of parts) {
                if (!part || typeof part !== 'object') continue
                // OpenAI 标准：video_url 分段
                if (part.type === 'video_url' && typeof part.video_url?.url === 'string') {
                    addUrl(part.video_url.url)
                    continue
                }
                // 一些后端用 video / output_video
                if (part.type === 'video' || part.type === 'output_video') {
                    if (typeof part.url === 'string') addUrl(part.url)
                    if (typeof part.video_url?.url === 'string') addUrl(part.video_url.url)
                }
                // 兜底：直接给 url
                if (typeof part.url === 'string') {
                    if (/\.(mp4|webm|mov|m4v|mkv)(\?|#|$)/i.test(part.url)) addUrl(part.url)
                    if (part.url.startsWith('base64://')) addUrl(part.url)
                    if (part.url.startsWith('data:video/')) addUrl(part.url)
                }
            }
        }

        if (Array.isArray(data)) {
            extractFromContentParts(data)
            return videoUrls
        }

        if (typeof data === 'object') {
            const pushFrom = v => {
                if (!v) return
                if (typeof v === 'string') return addUrl(v)
                if (typeof v === 'object') {
                    if (typeof v.url === 'string') addUrl(v.url)
                    if (typeof v.file === 'string') addUrl(v.file)
                    if (typeof v.video_url?.url === 'string') addUrl(v.video_url.url)
                    if (typeof v.video_url === 'string') addUrl(v.video_url)
                }
            }

            if (Array.isArray(data.videos)) data.videos.forEach(pushFrom)
            if (Array.isArray(data.video)) data.video.forEach(pushFrom)
            if (data.video_url) pushFrom(data.video_url)
            if (data.videoUrl) pushFrom(data.videoUrl)

            // OpenAI 标准：message.content 可能是数组
            if (Array.isArray(data.content)) extractFromContentParts(data.content)
        }

        // 文本内容中的链接（mp4/webm/mov/m4v/mkv）或 base64:// 或 data:video;base64
        const content = typeof data === 'string' ? data : typeof data.content === 'string' ? data.content : ''
        if (content) {
            // markdown 链接
            const mdMatches = [...content.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)]
            for (const m of mdMatches) {
                const u = m[1]
                if (/\.(mp4|webm|mov|m4v|mkv)(\?|#|$)/i.test(u)) addUrl(u)
            }

            // 常见视频后缀 URL（带查询参数也行）
            const urlMatches = [...content.matchAll(/(https?:\/\/[^\s<>()"']+)/g)]
            for (const m of urlMatches) {
                const u = m[1]
                if (/\.(mp4|webm|mov|m4v|mkv)(\?|#|$)/i.test(u)) addUrl(u)
            }

            const base64Matches = [...content.matchAll(/(base64:\/\/[A-Za-z0-9+/=]+)/g)]
            for (const m of base64Matches) addUrl(m[1])

            const dataVideoMatches = [...content.matchAll(/(data:video\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+)/gi)]
            for (const m of dataVideoMatches) addUrl(m[1])
        }

        return videoUrls
    }

    toVideoSegment(url) {
        if (!url || typeof url !== 'string') return null
        const trimmed = url.trim()
        if (!trimmed) return null

        if (trimmed.startsWith('base64://')) {
            return segment.video(trimmed)
        }

        if (trimmed.startsWith('data:video/') && trimmed.includes(';base64,')) {
            const base64 = trimmed.split(';base64,').pop()
            if (base64) return segment.video(`base64://${base64}`)
        }

        return segment.video(trimmed)
    }

    async generateVideo(e) {
        const startTime = Date.now()
        const rawPrompt = e.msg.replace(/^#cc视频\s*/, '').trim()

        const model = this.config.default_video_model || this.config.default_model || 'gemini-3-pro-image-preview'
        const prompt = rawPrompt || '根据提供的图片生成一段短视频，尽量保持主体一致性与风格一致性。'

        const maxQueue = this.config.max_queue || 5
        const maxConcurrent = this.config.max_concurrent || 1

        enqueueJob(e, `视频生成`, async () => {
            await this.performVideoGeneration(e, model, prompt, startTime)
        }, maxQueue, maxConcurrent, { kind: '视频', emoji: '🎬' })
    }

    async switchImageModel(e) {
        if (!e.isMaster) {
            await e.reply('❌ 仅主人可用')
            return true
        }

        const raw = e.msg.replace(/^#cc切换图片模型\s*/i, '').trim()
        if (!raw) {
            await e.reply('❌ 请提供模型名称\n用法：#cc切换图片模型<模型名>')
            return true
        }

        const normalized = raw.toLowerCase()
        const nextModel =
            ['default', '默认', '清空', 'clear', 'reset'].includes(normalized) ? '' : raw

        Config.modify('Banana', 'default_model', nextModel, 'config')
        const cfg = BananaService.config
        await e.reply(
            `✅ 已切换图片模型\n当前图片模型: ${cfg.default_model || '（空）'}\n当前视频模型: ${cfg.default_video_model || '（跟随图片模型）'}`,
        )
        return true
    }

    async switchVideoModel(e) {
        if (!e.isMaster) {
            await e.reply('❌ 仅主人可用')
            return true
        }

        const raw = e.msg.replace(/^#cc切换视频模型\s*/i, '').trim()
        if (!raw) {
            await e.reply('❌ 请提供模型名称\n用法：#cc切换视频模型<模型名>')
            return true
        }

        const normalized = raw.toLowerCase()
        const nextModel =
            ['default', '默认', '清空', 'clear', 'reset', 'follow', '跟随'].includes(normalized)
                ? ''
                : raw

        Config.modify('Banana', 'default_video_model', nextModel, 'config')
        const cfg = BananaService.config
        await e.reply(
            `✅ 已切换视频模型\n当前图片模型: ${cfg.default_model || '（空）'}\n当前视频模型: ${cfg.default_video_model || '（跟随图片模型）'}`,
        )
        return true
    }

    async performGeneration(e, model, prompt, startTime, isDirectCommand = false, presetName = null) {
        let imageUrls = []
        const quoteReply = true

        // 回复消息中的图片
        const replyImgs = await this.takeSourceMsg(e, { img: true })
        if (Array.isArray(replyImgs) && replyImgs.length > 0) {
            imageUrls.push(...replyImgs)
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
                const totalSize = base64Images.reduce((sum, img) => sum + img.length, 0)
                logger.debug(`[Banana] 成功转换 ${base64Images.length} 张图片为base64, 总大小: ${(totalSize / 1024).toFixed(1)}KB`)
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
                    await e.reply(replyMsg, quoteReply)
                } else if (Array.isArray(result.videoUrls) && result.videoUrls.length > 0) {
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
                    const replyMsg = []
                    for (const url of result.videoUrls.slice(0, 3)) {
                        const seg = this.toVideoSegment(url)
                        if (seg) replyMsg.push(seg)
                    }
                    replyMsg.push(`\n✅ 生成完成（${elapsed}s）\n🤖 模型: ${model}\n⚠️ 检测到视频输出，已发送视频结果。`)
                    await e.reply(replyMsg, quoteReply)
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

            await e.reply(errorMsg, quoteReply)
        }
    }

	    async performVideoGeneration(e, model, prompt, startTime) {
        let imageUrls = []
        const quoteReply = true

        const replyImgs = await this.takeSourceMsg(e, { img: true })
        if (Array.isArray(replyImgs) && replyImgs.length > 0) {
            imageUrls.push(...replyImgs)
        }

        const currentMsgImgs = e.message
            .filter(m => m.type === 'image' && m.url)
            .map(m => m.url)
        if (currentMsgImgs.length > 0) imageUrls.push(...currentMsgImgs)

        // 若无图片：优先取 @ 的头像，否则取发送者头像
        if (imageUrls.length === 0) {
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

        // 视频生成必须有参考图（至少 1 张）
        if (imageUrls.length === 0) {
            await e.reply('❌ 视频生成必须提供一张参考图：请在消息中附带图片，或回复一张图片再发送 #cc视频 [提示词]')
            return
        }

        // 视频模型通常只需要 1 张参考图
        if (imageUrls.length > 0) {
            const unique = Array.from(new Set(imageUrls.filter(Boolean)))
            imageUrls = unique.slice(0, 1)
        }

        const refImageUrl = await this.normalizeVideoRefImageUrl(imageUrls[0])
        if (!refImageUrl) {
            await e.reply('❌ 参考图处理失败：无法获取可用图片（建议换一张 jpg/png 图片再试）')
            return
        }

        let content = []
        if (prompt) {
            content.push({ type: 'text', text: prompt })
        }

        // OpenAI 标准：messages[].content[] 传 text + image_url
        content.push({ type: 'image_url', image_url: { url: refImageUrl } })

        if (content.length === 0) {
            content.push({ type: 'text', text: '生成一段短视频' })
        }

        // 生产视频强制使用流式
        const useStream = true
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

        logger.debug(`[Banana] 视频 API 请求 - 地址: ${apiUrl}`)
        logger.debug(`[Banana] 视频 API 请求 - 模型: ${model}`)
        logger.debug(`[Banana] 视频 API 请求 - 模式: ${useStream ? '流式' : '非流式'}`)
        // 打印真实入参结构（会省略 base64 的大段内容）
        logger.debug(`[Banana] 视频 API 请求 - 入参(省略): ${JSON.stringify(omitBase64ForLog(payload, 80))}`)

        try {
            const result = await this.streamRequest(apiUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload),
                logStream: true
            })

            if (!result.success) throw new Error(result.error)

            BananaService.recordKeyUsage(currentApiKey, true)
            const videoUrls = result.videoUrls || []
            const imageFallback = result.imageUrls || []

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
            const summaryMsg = `✅ 视频生成完成（${elapsed}s）\n🤖 模型: ${model}`

            if (videoUrls.length > 0) {
                // 先单独发视频，再发总结
                for (const url of videoUrls.slice(0, 3)) {
                    const seg = this.toVideoSegment(url)
                    if (seg) await e.reply(seg, quoteReply)
                }
                await e.reply(summaryMsg, quoteReply)
                return
            } else if (imageFallback.length > 0) {
                // 某些后端可能用图片形式返回（兜底）
                await e.reply(imageFallback.slice(0, 3).map(url => segment.image(url)), quoteReply)
                await e.reply(`${summaryMsg}\n⚠️ 未检测到视频输出，已发送图片结果作为兜底。`, quoteReply)
                return
            } else {
                throw new Error('未找到生成的内容（未解析到视频/图片 URL）')
            }
        } catch (err) {
            BananaService.recordKeyUsage(currentApiKey, false, err?.message)

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
            let errorMsg = `❌ 生成失败（${elapsed}s）`
            errorMsg += `\n错误: ${err.message}`
            await e.reply(errorMsg, quoteReply)
        }
    }

    async streamRequest(url, options) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url)
            const isHttps = urlObj.protocol === 'https:'
            const httpModule = isHttps ? https : http
            const logStream = Boolean(options?.logStream)
            const logPrefix = "[Banana][Stream]"

            const truncateForLog = (text, max = 240) => {
                const s = String(text ?? "")
                    .replace(/\r?\n/g, "\\n")
                    .trim()
                if (s.length <= max) return s
                return `${s.slice(0, max)}…(${s.length})`
            }

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
                let finalVideoUrls = []
                let errorMessages = []

                const processJsonChunk = jsonData => {
                    if (!jsonData || typeof jsonData !== 'object') return

                    // 兼容 OpenAI：choices[].delta / choices[].message
                    const choice = jsonData.choices?.[0]
                    const delta = choice?.delta
                    const message = choice?.message

                    if (logStream) {
                        const content = delta?.content ?? message?.content
                        if (typeof content === "string" && content.trim()) {
                            logger.debug(`${logPrefix} ${truncateForLog(content)}`)
                        }
                    }

                    if (delta?.reasoning_content) {
                        const reasoning = delta.reasoning_content
                        if (typeof reasoning === 'string' && (reasoning.includes('❌') || reasoning.includes('生成失败')))
                            errorMessages.push(reasoning.trim())
                    }

                    if (delta) {
                        finalImageUrls = this.extractImagesFromData(delta, finalImageUrls)
                        finalVideoUrls = this.extractVideosFromData(delta, finalVideoUrls)
                    }

                    if (message) {
                        finalImageUrls = this.extractImagesFromData(message, finalImageUrls)
                        finalVideoUrls = this.extractVideosFromData(message, finalVideoUrls)
                    }
                }

                const processDataLine = dataLine => {
                    const data = String(dataLine || '').trim()
                    if (!data) return

                    if (data === '[DONE]') {
                        if (logStream) logger.debug(`${logPrefix} [DONE]`)
                        if (finalVideoUrls.length > 0 || finalImageUrls.length > 0)
                            resolve({ success: true, imageUrls: finalImageUrls, videoUrls: finalVideoUrls })
                        else if (errorMessages.length > 0)
                            resolve({ success: false, error: `生成失败: ${errorMessages.join('\n')}` })
                        else resolve({ success: false, error: '未找到生成的内容' })
                        return 'done'
                    }

                    // 标准 SSE: data: {...}
                    try {
                        if (logStream) logger.debug(`${logPrefix} data: ${truncateForLog(data)}`)
                        processJsonChunk(JSON.parse(data))
                        return 'ok'
                    } catch {}

                    return 'skip'
                }

                res.on('data', chunk => {
                    const chunkStr = chunk.toString()
                    buffer += chunkStr

                    const lines = buffer.split(/\r?\n/)
                    buffer = lines.pop()

                    for (const line of lines) {
                        const trimmed = String(line || '').trim()
                        if (!trimmed) continue
                        if (trimmed.startsWith('event:')) continue
                        if (trimmed.startsWith('id:')) continue
                        if (trimmed.startsWith('retry:')) continue

                        if (trimmed.startsWith('data:')) {
                            const ret = processDataLine(trimmed.slice(5))
                            if (ret === 'done') return
                            continue
                        }

                        // 兼容非 SSE：直接一行 JSON
                        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                            try {
                                processJsonChunk(JSON.parse(trimmed))
                            } catch {
                                // ignore
                            }
                        }
                    }
                })

                res.on('end', () => {
                    // 处理末尾未换行的数据
                    const tail = String(buffer || '').trim()
                    if (tail) {
                        if (tail.startsWith('data:')) {
                            const ret = processDataLine(tail.slice(5))
                            if (ret === 'done') return
                        } else if (tail.startsWith('{') || tail.startsWith('[')) {
                            try {
                                processJsonChunk(JSON.parse(tail))
                            } catch {
                                // ignore
                            }
                        }
                    }

                    if (finalVideoUrls.length > 0 || finalImageUrls.length > 0) {
                        resolve({ success: true, imageUrls: finalImageUrls, videoUrls: finalVideoUrls })
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

    parseDataImageUrl(dataUrl) {
        if (typeof dataUrl !== 'string') return null
        if (!dataUrl.startsWith('data:image/')) return null

        const comma = dataUrl.indexOf(',')
        if (comma < 0) return null

        const meta = dataUrl.slice(5, comma) // e.g. image/png;base64
        const data = dataUrl.slice(comma + 1)
        const [mime, ...params] = meta.split(';')

        if (!mime?.startsWith('image/')) return null
        const isBase64 = params.includes('base64')
        return { mime, isBase64, data, params }
    }

    async convertBufferToPngBase64(buffer) {
        try {
            const { default: sharp } = await import('sharp')
            const out = await sharp(buffer).png().toBuffer()
            return `data:image/png;base64,${out.toString('base64')}`
        } catch (err) {
            logger?.warn?.(`[Banana] sharp 转换失败: ${err?.message || err}`)
            return null
        }
    }

    async normalizeVideoRefImageUrl(url) {
        if (!url || typeof url !== 'string') return null

        // data url：若非 jpg/jpeg/png，则尝试转为 png base64
        if (url.startsWith('data:image/')) {
            const parsed = this.parseDataImageUrl(url)
            if (!parsed) return null
            if (parsed.mime === 'image/png' || parsed.mime === 'image/jpeg') return url

            let buffer
            if (parsed.isBase64) {
                buffer = Buffer.from(parsed.data, 'base64')
            } else {
                try {
                    buffer = Buffer.from(decodeURIComponent(parsed.data))
                } catch {
                    buffer = Buffer.from(parsed.data)
                }
            }
            const converted = await this.convertBufferToPngBase64(buffer)
            return converted
        }

        // 先 HEAD 轻量判断类型：jpg/jpeg/png 则直接用 URL
        try {
            const head = await BananaService.httpRequest(url, { method: 'HEAD', timeout: 8000 })
            const ct = head?.headers?.['content-type']
            if (typeof ct === 'string') {
                const mime = ct.split(';')[0].trim().toLowerCase()
                if (mime === 'image/png' || mime === 'image/jpeg') return url
            }
        } catch {
            // ignore
        }

        // GET 下载判断并必要时转码（确保最终为 jpg/png 的 data url）
        let response
        try {
            response = await BananaService.httpRequest(url, { method: 'GET', timeout: 30000 })
        } catch (err) {
            logger?.warn?.(`[Banana] 参考图下载失败: ${err?.message || err}`)
            return null
        }

        if (!response?.ok) return null
        const buffer = Buffer.from(await response.arrayBuffer())

        // GIF：沿用现有逻辑（提首帧成 jpeg）
        if (BananaService.isGifBuffer?.(buffer)) {
            if (await BananaService.checkFfmpeg?.()) {
                try {
                    const jpg = await BananaService.extractGifFirstFrame(buffer)
                    return `data:image/jpeg;base64,${jpg.toString('base64')}`
                } catch (err) {
                    logger?.warn?.(`[Banana] GIF 首帧提取失败: ${err?.message || err}`)
                    return null
                }
            }
            return null
        }

        const ct = response?.headers?.['content-type']
        if (typeof ct === 'string') {
            const mime = ct.split(';')[0].trim().toLowerCase()
            if (mime === 'image/png' || mime === 'image/jpeg') return url
        }

        // 非 jpg/png：转 png base64
        const png = await this.convertBufferToPngBase64(buffer)
        return png
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
                        let finalVideoUrls = []
                        if (jsonData.choices?.[0]?.message) {
                            finalImageUrls = this.extractImagesFromData(jsonData.choices[0].message, finalImageUrls)
                            finalVideoUrls = this.extractVideosFromData(jsonData.choices[0].message, finalVideoUrls)
                        }

                        if (finalVideoUrls.length > 0 || finalImageUrls.length > 0) {
                            resolve({ success: true, imageUrls: finalImageUrls, videoUrls: finalVideoUrls })
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
