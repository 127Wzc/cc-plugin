import https from 'https'
import http from 'http'
import BananaService from '../model/BananaService.js'
import MessageImageResolver from '../model/MessageImageResolver.js'
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

function getImagesApiUrl(apiUrl, endpoint) {
    const urlObj = new URL(apiUrl)
    const normalizedPath = urlObj.pathname.replace(/\/+$/, '')
    if (/\/v1\/chat\/completions$/i.test(normalizedPath)) {
        urlObj.pathname = normalizedPath.replace(/\/v1\/chat\/completions$/i, `/v1/images/${endpoint}`)
    } else if (/\/v1$/i.test(normalizedPath)) {
        urlObj.pathname = `${normalizedPath}/images/${endpoint}`
    } else if (/\/v1\/images\/(generations|edits)$/i.test(normalizedPath)) {
        urlObj.pathname = normalizedPath.replace(/\/v1\/images\/(generations|edits)$/i, `/v1/images/${endpoint}`)
    } else {
        urlObj.pathname = `/v1/images/${endpoint}`
    }
    return urlObj.toString()
}

function buildMultipartBody(fields, files) {
    const boundary = `----BananaBoundary${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
    const chunks = []

    for (const [name, value] of Object.entries(fields)) {
        if (value === undefined || value === null || value === '') continue
        chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
    }

    for (const file of files) {
        chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`))
        chunks.push(file.buffer)
        chunks.push(Buffer.from('\r\n'))
    }

    chunks.push(Buffer.from(`--${boundary}--\r\n`))
    return { boundary, body: Buffer.concat(chunks) }
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

const PROMPT_VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/

export class banana extends plugin {
    constructor() {
        super({
            name: '[cc-plugin] Banana 大香蕉',
            dsc: '大香蕉图片生成插件',
            event: 'message',
            priority: 200,
            rule: [
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
                    reg: '^#大香蕉调试$',
                    fnc: 'debugBanana'
                },
                {
                    reg: '^#大香蕉预设列表$',
                    fnc: 'listPresets'
                }
            ]
        })
    }

    get config() {
        return BananaService.config
    }

    async accept(e) {
        const parsed = this.parsePresetCommand(e?.msg)
        if (!parsed) return false

        await this.generateImageByPreset(e, parsed)
        return 'return'
    }

    getAtUserId(e) {
        const atSeg = e.message?.find?.(m => m.type === 'at' && m.qq)
        if (/^all$/i.test(String(atSeg?.qq || ''))) return ''
        return atSeg?.qq ? String(atSeg.qq) : ''
    }

    getTargetUserId(e, explicitUserId = '') {
        const userId = String(explicitUserId || this.getAtUserId(e) || e.user_id || '').trim()
        return /^all$/i.test(userId) ? String(e.user_id || '') : userId
    }

    async resolveImageUrls(e, { maxImages = 3 } = {}) {
        return MessageImageResolver.resolve(e, {
            current: true,
            quoted: true,
            maxImages
        })
    }

    async getDisplayName(e, userId = e.user_id, manualNickname = '') {
        const manualName = String(manualNickname || '').trim()
        if (manualName) return manualName

        const targetUserId = String(userId || e.user_id || '').trim()
        const isSender = !targetUserId || String(e.user_id) === targetUserId

        if (isSender) {
            return e.sender?.card || e.sender?.nickname || e.nickname || targetUserId
        }

        try {
            const member = e.group?.pickMember?.(targetUserId)
            let memberInfo = member?.info
            if (!memberInfo && member?.getInfo) memberInfo = await member.getInfo().catch(() => null)
            const name = memberInfo?.card || memberInfo?.nickname || member?.card || member?.nickname
            if (name) return name
        } catch (err) {
            logger?.debug?.(`[Banana] 获取群昵称失败: ${err?.message || err}`)
        }

        try {
            const friend = e.bot?.pickFriend?.(targetUserId)
            let friendInfo = friend?.info
            if (!friendInfo && friend?.getInfo) friendInfo = await friend.getInfo().catch(() => null)
            const name = friendInfo?.card || friendInfo?.nickname || friend?.card || friend?.nickname
            if (name) return name
        } catch (err) {
            logger?.debug?.(`[Banana] 获取用户昵称失败: ${err?.message || err}`)
        }

        return targetUserId || String(e.user_id || '')
    }

    parsePresetCommand(msg = '') {
        const text = String(msg || '').trim()
        if (!text.startsWith('#')) return null

        const presets = BananaService.getPresets()
        if (!Array.isArray(presets) || presets.length === 0) return null

        const cmdList = presets
            .map(p => String(p?.cmd || '').trim())
            .filter(Boolean)
            .sort((a, b) => b.length - a.length)

        const presetPrefixMatch = text.match(/^#预设(?:\s+(.+))?$/)
        if (presetPrefixMatch) {
            const rest = String(presetPrefixMatch[1] || '').trim()
            if (!rest) return null
            for (const cmd of cmdList) {
                if (rest === cmd || rest.startsWith(`${cmd} `)) {
                    return {
                        cmd,
                        args: rest.slice(cmd.length).trim()
                    }
                }
            }
            return null
        }

        for (const cmd of cmdList) {
            const prefix = `#${cmd}`
            if (text === prefix || text.startsWith(`${prefix} `)) {
                return {
                    cmd,
                    args: text.slice(prefix.length).trim()
                }
            }
        }

        return null
    }

    parsePresetArgs(e, rawArgs = '') {
        const args = String(rawArgs || '').trim()
        if (!args) return { targetUserId: '', manualNickname: '', appendPrompt: '' }

        const promptMatch = args.match(/(?:^|\s)-p\s+([\s\S]+)$/)
        const appendPrompt = promptMatch ? promptMatch[1].trim() : ''
        const nameArgs = promptMatch ? args.slice(0, promptMatch.index).trim() : args

        if (!nameArgs) return { targetUserId: '', manualNickname: '', appendPrompt }

        const explicitNameMatch = nameArgs.match(/^(?:昵称|名字|name|nickname)\s*[=:：]\s*(.+)$/i)
        if (explicitNameMatch) {
            return { targetUserId: '', manualNickname: explicitNameMatch[1].trim(), appendPrompt }
        }

        const explicitTargetMatch = nameArgs.match(/^(?:qq|user|user_id)\s*[=:：]\s*(\d{5,12})(?:\s+(?:昵称|名字|name|nickname)\s*[=:：]\s*(.+)|\s+(.+))?$/i)
        if (explicitTargetMatch) {
            return {
                targetUserId: explicitTargetMatch[1],
                manualNickname: String(explicitTargetMatch[2] || explicitTargetMatch[3] || '').trim(),
                appendPrompt
            }
        }

        const atUserId = this.getAtUserId(e)
        if (atUserId && nameArgs.startsWith('@')) {
            const rest = nameArgs.replace(/^@\S+\s*/, '').trim()
            const nameMatch = rest.match(/^(?:昵称|名字|name|nickname)\s*[=:：]\s*(.+)$/i)
            return { targetUserId: atUserId, manualNickname: (nameMatch?.[1] || rest).trim(), appendPrompt }
        }

        const targetMatch = nameArgs.match(/^@?(\d{5,12})(?:\s+(.+))?$/)
        if (targetMatch) {
            return {
                targetUserId: targetMatch[1],
                manualNickname: String(targetMatch[2] || '').trim(),
                appendPrompt
            }
        }

        return { targetUserId: '', manualNickname: nameArgs, appendPrompt }
    }

    buildPresetPrompt(prompt, appendPrompt = '') {
        const basePrompt = String(prompt || '').trim()
        const extraPrompt = String(appendPrompt || '').trim()
        if (!extraPrompt) return basePrompt
        if (!basePrompt) return extraPrompt
        return `${basePrompt}\n\n用户追加要求：\n${extraPrompt}`
    }

    getRetryCount() {
        const value = Number(this.config.retry_count ?? 3)
        if (!Number.isFinite(value)) return 3
        return Math.max(0, Math.min(10, Math.floor(value)))
    }

    isImageQuotaRetryError(err) {
        const message = String(err?.message || err || '')
        return /no available image quota/i.test(message)
    }

    getRetryLimitForError(err) {
        if (this.isImageQuotaRetryError(err)) return 5
        return this.getRetryCount()
    }

    getRetryDelayForError(err) {
        if (this.isImageQuotaRetryError(err)) return 6000
        return 0
    }

    getMaxRetryLoopAttempts() {
        return Math.max(this.getRetryCount(), 5) + 1
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    shouldRetryError(err) {
        const message = String(err?.message || err || '')
        if (!message) return true
        return !/(内容政策|content[_-]?policy|policy violation|提示.*违反|没有可用的API密钥|没有活跃的API密钥)/i.test(message)
    }

    formatRetrySuffix(attemptsUsed) {
        return attemptsUsed > 1 ? `\n已尝试: ${attemptsUsed} 次` : ''
    }

    async renderPromptVariables(e, prompt, targetUserId = '', manualNickname = '') {
        if (typeof prompt !== 'string' || !PROMPT_VARIABLE_PATTERN.test(prompt)) return prompt

        const userId = this.getTargetUserId(e, targetUserId)
        const nickname = await this.getDisplayName(e, userId, manualNickname)
        const variables = {
            nickname,
            name: nickname,
            qq: userId,
            user_id: userId,
            group_name: e.group_name || '',
            group_id: e.group_id ? String(e.group_id) : '',
            sender_nickname: e.sender?.card || e.sender?.nickname || e.nickname || String(e.user_id || ''),
            sender_qq: e.user_id ? String(e.user_id) : ''
        }

        return prompt.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (raw, key) => {
            const value = variables[String(key).toLowerCase()]
            return value === undefined ? raw : value
        })
    }

    async generateImageByPreset(e, parsedCommand = null) {
        const startTime = Date.now()
        const parsed = parsedCommand || this.parsePresetCommand(e?.msg)

        if (!parsed) {
            await e.reply('❌ 预设命令格式错误')
            return
        }

        const cmd = parsed.cmd
        const { targetUserId, manualNickname, appendPrompt } = this.parsePresetArgs(e, parsed.args)
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
            const prompt = this.buildPresetPrompt(preset.prompt, appendPrompt)
            await this.performGeneration(e, fullModel, prompt, startTime, false, `#${presetCmd}`, targetUserId, manualNickname)
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
                if (!imageUrls.includes(normalized)) imageUrls.push(normalized)
            } else if (normalized.startsWith('http') && !imageUrls.includes(normalized)) {
                imageUrls.push(normalized)
            }
        }

        const addBase64Image = value => {
            if (!value || typeof value !== 'string') return
            const trimmed = value.trim()
            if (!trimmed) return

            if (trimmed.startsWith('data:image/')) {
                addImageUrl(trimmed)
                return
            }

            const compact = trimmed.replace(/\s+/g, '')
            const mime = this.inferImageMimeFromBase64(compact)
            if (!mime) return

            addImageUrl(`data:${mime};base64,${compact}`)
        }

        const addStringImage = value => {
            if (typeof value !== 'string') return
            addImageUrl(value)
            addBase64Image(value)
        }

        // OpenAI 标准：content 可能是数组（多模态分段）
        const extractFromContentParts = parts => {
            if (!Array.isArray(parts)) return
            for (const part of parts) {
                if (!part || typeof part !== 'object') continue
                if (part.type === 'image_url' || part.type === 'output_image' || part.type === 'input_image') {
                    if (typeof part.image_url === 'string') {
                        addImageUrl(part.image_url)
                        continue
                    }
                    if (part.image_url?.url) {
                        addImageUrl(part.image_url.url)
                        continue
                    }
                    if (typeof part.url === 'string') {
                        addImageUrl(part.url)
                        continue
                    }
                }
                if (typeof part.image_url === 'string') {
                    addImageUrl(part.image_url)
                    continue
                }
                if (part.image_url?.url) {
                    addImageUrl(part.image_url.url)
                    continue
                }
                if (typeof part.url === 'string') {
                    // 兼容部分后端直接给 url 字段
                    addImageUrl(part.url)
                }
                if (typeof part.b64_json === 'string') {
                    addImageUrl(`data:image/png;base64,${part.b64_json}`)
                }
                for (const key of ['base64', 'image', 'image_base64', 'output', 'result', 'text', 'content']) {
                    addStringImage(part[key])
                }
            }
        }

        if (Array.isArray(data)) {
            extractFromContentParts(data)
            return imageUrls
        }

        for (const key of ['url', 'image_url']) {
            if (typeof data[key] === 'string') addImageUrl(data[key])
            else if (data[key]?.url) addImageUrl(data[key].url)
        }

        if (typeof data.b64_json === 'string') {
            addImageUrl(`data:image/png;base64,${data.b64_json}`)
        }

        for (const key of ['base64', 'image', 'image_base64', 'output', 'result']) {
            addStringImage(data[key])
            if (data[key] && typeof data[key] === 'object') {
                extractFromContentParts(Array.isArray(data[key]) ? data[key] : [data[key]])
            }
        }

        for (const key of ['outputs', 'artifacts', 'results']) {
            if (Array.isArray(data[key])) extractFromContentParts(data[key])
        }

        if (data.images && Array.isArray(data.images)) {
            for (const img of data.images) {
                extractFromContentParts([img])
            }
        }

        if (data.data && Array.isArray(data.data)) {
            for (const item of data.data) {
                extractFromContentParts([item])
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
            addBase64Image(content)
        }

        return imageUrls
    }

    inferImageMimeFromBase64(value) {
        if (!value || typeof value !== 'string') return ''
        if (value.length < 512) return ''
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return ''

        let head
        try {
            head = Buffer.from(value.slice(0, 96), 'base64')
        } catch {
            return ''
        }

        if (head.length < 8) return ''
        if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png'
        if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
        if (head.slice(0, 4).toString() === 'RIFF' && head.slice(8, 12).toString() === 'WEBP') return 'image/webp'
        if (head.slice(0, 3).toString() === 'GIF') return 'image/gif'

        return ''
    }

    collectTextFromData(data) {
        if (!data || typeof data !== 'object') return ''

        const texts = []
        const push = value => {
            if (typeof value === 'string') texts.push(value)
        }

        const collectFromContent = content => {
            if (typeof content === 'string') {
                push(content)
                return
            }
            if (!Array.isArray(content)) return

            for (const part of content) {
                if (!part || typeof part !== 'object') continue
                push(part.text)
                push(part.content)
            }
        }

        push(data.text)
        push(data.output_text)
        collectFromContent(data.content)

        const choice = data.choices?.[0]
        if (choice) {
            push(choice.text)
            collectFromContent(choice.delta?.content)
            collectFromContent(choice.message?.content)
        }

        return texts.join('')
    }

    compactResponseText(value, maxLength = 800) {
        if (value === undefined || value === null) return ''
        let text = typeof value === 'string' ? value : JSON.stringify(value)
        text = text
            .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi, '[base64图片已省略]')
            .replace(/data:video\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi, '[base64视频已省略]')
            .replace(/[A-Za-z0-9+/=]{500,}/g, '[base64内容已省略]')
            .trim()
        if (text.length > maxLength) return `${text.slice(0, maxLength)}...`
        return text
    }

    extractApiErrorMessage(data, fallback = '', includeTextFallback = true) {
        let payload = data
        if (typeof payload === 'string') {
            const text = payload.trim()
            if (!text) return ''
            try {
                payload = JSON.parse(text)
            } catch {
                return this.compactResponseText(text)
            }
        }

        if (!payload || typeof payload !== 'object') {
            return this.compactResponseText(fallback)
        }

        const messages = []
        const add = value => {
            if (value === undefined || value === null || value === '') return
            const text = this.compactResponseText(value, 300)
            if (!text) return
            if (!messages.includes(text)) messages.push(text)
        }

        const addErrorObject = err => {
            if (!err) return
            if (typeof err === 'string') {
                add(err)
                return
            }
            if (typeof err !== 'object') return
            add(err.message)
            if (typeof err.detail === 'string') add(err.detail)
            else if (err.detail?.message) add(err.detail.message)
        }

        addErrorObject(payload.error)
        add(payload.message)
        add(payload.msg)
        addErrorObject(payload.detail)

        if (Array.isArray(payload.choices)) {
            for (const choice of payload.choices) {
                if (!choice || typeof choice !== 'object') continue
                addErrorObject(choice.error)
                add(choice.message?.refusal)
                add(choice.delta?.refusal)
            }
        }

        if (messages.length > 0) return this.compactResponseText(messages.join('；'))

        if (!includeTextFallback) return this.compactResponseText(fallback)

        const text = this.collectTextFromData(payload)
        return this.compactResponseText(text || fallback)
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

    async performGeneration(e, model, prompt, startTime, isDirectCommand = false, presetName = null, targetUserId = '', manualNickname = '') {
        const quoteReply = true
        prompt = await this.renderPromptVariables(e, prompt, targetUserId, manualNickname)
        const imageUrls = await this.resolveImageUrls(e, {
            maxImages: 3
        })

        const apiUrl = this.config.api_url
        if (!apiUrl) {
            await e.reply('❌ 请先配置 API 服务地址')
            return
        }

        const imageProtocol = String(this.config.image_api_protocol || 'chat_completions').trim()
        if (imageProtocol === 'openai_images') {
            await this.performOpenAIImagesGeneration(e, {
                apiUrl,
                model,
                prompt,
                imageUrls,
                startTime,
                presetName,
                quoteReply
            })
            return
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

        const urlObj = new URL(apiUrl)

        logger.debug(`[Banana] API 请求 - 地址: ${apiUrl}`)
        logger.debug(`[Banana] API 请求 - 模型: ${model}`)
        logger.debug(`[Banana] API 请求 - 模式: ${useStream ? '流式' : '非流式'}`)

        const maxAttempts = this.getMaxRetryLoopAttempts()
        let lastError = null
        let attemptsUsed = 0

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            let currentApiKey = null
            attemptsUsed = attempt
            try {
                currentApiKey = BananaService.getNextApiKey()
                const headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentApiKey}`,
                    'User-Agent': 'Yunzai-Banana-Plugin/1.0.0',
                    'Accept': '*/*',
                    'Host': urlObj.host,
                    'Connection': 'keep-alive'
                }

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

                if (!result.success) throw new Error(result.error)

                BananaService.recordKeyUsage(currentApiKey, true)
                const resultImageUrls = result.imageUrls || (result.imageUrl ? [result.imageUrl] : [])
                if (resultImageUrls.length > 0) {
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
                    const countText = resultImageUrls.length > 1 ? `\n📷 共 ${resultImageUrls.length} 张图片` : ''

                    const replyMsg = resultImageUrls.map(url => segment.image(url))
                    const presetText = presetName ? `\n🎯 预设: ${presetName}` : ''
                    const retryText = attemptsUsed > 1 ? `\n🔁 重试后成功: ${attemptsUsed} 次尝试` : ''
                    replyMsg.push(`\n✅ 图片生成完成（${elapsed}s）\n🤖 模型: ${model}${presetText}${countText}${retryText}`)
                    await e.reply(replyMsg, quoteReply)
                    return
                } else if (Array.isArray(result.videoUrls) && result.videoUrls.length > 0) {
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
                    const replyMsg = []
                    for (const url of result.videoUrls.slice(0, 3)) {
                        const seg = this.toVideoSegment(url)
                        if (seg) replyMsg.push(seg)
                    }
                    const retryText = attemptsUsed > 1 ? `\n🔁 重试后成功: ${attemptsUsed} 次尝试` : ''
                    replyMsg.push(`\n✅ 生成完成（${elapsed}s）\n🤖 模型: ${model}\n⚠️ 检测到视频输出，已发送视频结果。${retryText}`)
                    await e.reply(replyMsg, quoteReply)
                    return
                }

                throw new Error('未找到生成的内容')
            } catch (err) {
                lastError = err
                if (currentApiKey) BananaService.recordKeyUsage(currentApiKey, false, err?.message)
                const retryLimit = this.getRetryLimitForError(err)
                if (attempt <= retryLimit && this.shouldRetryError(err)) {
                    const delayMs = this.getRetryDelayForError(err)
                    logger?.debug?.(`[Banana] 图片生成失败，准备重试 ${attempt}/${retryLimit}: ${err?.message || err}`)
                    if (delayMs > 0) await this.sleep(delayMs)
                    continue
                }
                break
            }
        }

        const err = lastError || new Error('生成失败')

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
        let errorMsg = `❌ 生成失败（${elapsed}s）`
        errorMsg += `\n错误: ${err.message}${this.formatRetrySuffix(attemptsUsed)}`

        if (err.code === 'ECONNRESET' || err.message?.includes('socket hang up')) {
            errorMsg += `\n\n💡 建议: 这通常是网络不稳定或服务器负载过高导致，请稍后再试`
        } else if (err.code === 'ENOTFOUND') {
            errorMsg += `\n\n💡 建议: DNS解析失败，请检查网络连接`
        } else if (err.code === 'ETIMEDOUT') {
            errorMsg += `\n\n💡 建议: 连接超时，请检查网络`
        }

        await e.reply(errorMsg, quoteReply)
    }

    async performOpenAIImagesGeneration(e, { apiUrl, model, prompt, imageUrls, startTime, presetName, quoteReply }) {
        const hasImages = Array.isArray(imageUrls) && imageUrls.length > 0
        const endpoint = hasImages ? 'edits' : 'generations'
        const requestUrl = getImagesApiUrl(apiUrl, endpoint)
        const responseFormat = this.config.image_response_format || 'url'
        const headers = {
            'User-Agent': 'Yunzai-Banana-Plugin/1.0.0',
            'Accept': '*/*',
            'Connection': 'keep-alive'
        }

        let body
        if (hasImages) {
            const base64Images = await BananaService.convertImagesToBase64(imageUrls)
            const files = []
            for (let i = 0; i < base64Images.length; i++) {
                const parsed = this.parseDataImageUrl(base64Images[i])
                if (!parsed?.isBase64) continue
                const ext = parsed.mime.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
                files.push({
                    name: 'image',
                    filename: `image_${i + 1}.${ext}`,
                    contentType: parsed.mime,
                    buffer: Buffer.from(parsed.data, 'base64')
                })
            }
            if (files.length === 0) throw new Error('图片处理失败：无法构建 edits 请求')

            const multipart = buildMultipartBody({
                model,
                prompt: prompt || '编辑这张图片',
                n: 1,
                response_format: responseFormat
            }, files)
            body = multipart.body
            headers['Content-Type'] = `multipart/form-data; boundary=${multipart.boundary}`
            headers['Content-Length'] = body.length
        } else {
            headers['Content-Type'] = 'application/json'
            body = JSON.stringify({
                model,
                prompt: prompt || '生成一个有趣的图片',
                n: 1,
                response_format: responseFormat
            })
        }

        logger.debug(`[Banana] Images API 请求 - 地址: ${requestUrl}`)
        logger.debug(`[Banana] Images API 请求 - 端点: /v1/images/${endpoint}`)
        logger.debug(`[Banana] Images API 请求 - 模型: ${model}`)
        logger.debug(`[Banana] Images API 请求 - response_format: ${responseFormat}`)

        const maxAttempts = this.getMaxRetryLoopAttempts()
        let lastError = null
        let attemptsUsed = 0

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            let currentApiKey = null
            attemptsUsed = attempt
            try {
                currentApiKey = BananaService.getNextApiKey()
                const result = await this.nonStreamRequest(requestUrl, {
                    method: 'POST',
                    headers: {
                        ...headers,
                        'Authorization': `Bearer ${currentApiKey}`
                    },
                    body
                })

                if (!result.success) throw new Error(result.error)

                BananaService.recordKeyUsage(currentApiKey, true)
                const resultImageUrls = result.imageUrls || []
                const resultVideoUrls = result.videoUrls || []

                if (resultImageUrls.length > 0) {
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
                    const countText = resultImageUrls.length > 1 ? `\n📷 共 ${resultImageUrls.length} 张图片` : ''
                    const presetText = presetName ? `\n🎯 预设: ${presetName}` : ''
                    const retryText = attemptsUsed > 1 ? `\n🔁 重试后成功: ${attemptsUsed} 次尝试` : ''
                    const replyMsg = resultImageUrls.map(url => segment.image(url))
                    replyMsg.push(`\n✅ 图片生成完成（${elapsed}s）\n🤖 模型: ${model}${presetText}\n🔌 协议: OpenAI Images / ${endpoint}${countText}${retryText}`)
                    await e.reply(replyMsg, quoteReply)
                    return
                } else if (resultVideoUrls.length > 0) {
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
                    const replyMsg = []
                    for (const url of resultVideoUrls.slice(0, 3)) {
                        const seg = this.toVideoSegment(url)
                        if (seg) replyMsg.push(seg)
                    }
                    const retryText = attemptsUsed > 1 ? `\n🔁 重试后成功: ${attemptsUsed} 次尝试` : ''
                    replyMsg.push(`\n✅ 生成完成（${elapsed}s）\n🤖 模型: ${model}\n🔌 协议: OpenAI Images / ${endpoint}${retryText}`)
                    await e.reply(replyMsg, quoteReply)
                    return
                }

                throw new Error('未找到生成的内容')
            } catch (err) {
                lastError = err
                if (currentApiKey) BananaService.recordKeyUsage(currentApiKey, false, err?.message)
                const retryLimit = this.getRetryLimitForError(err)
                if (attempt <= retryLimit && this.shouldRetryError(err)) {
                    const delayMs = this.getRetryDelayForError(err)
                    logger?.debug?.(`[Banana] Images API 生成失败，准备重试 ${attempt}/${retryLimit}: ${err?.message || err}`)
                    if (delayMs > 0) await this.sleep(delayMs)
                    continue
                }
                break
            }
        }

        const err = lastError || new Error('生成失败')
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
        await e.reply(`❌ 生成失败（${elapsed}s）\n错误: ${err.message}${this.formatRetrySuffix(attemptsUsed)}`, quoteReply)
    }

    async performVideoGeneration(e, model, prompt, startTime) {
        const quoteReply = true
        let imageUrls = await this.resolveImageUrls(e, {
            maxImages: 1
        })

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

        const apiUrl = this.config.api_url
        if (!apiUrl) {
            await e.reply('❌ 请先配置 API 服务地址')
            return
        }

        const urlObj = new URL(apiUrl)

        logger.debug(`[Banana] 视频 API 请求 - 地址: ${apiUrl}`)
        logger.debug(`[Banana] 视频 API 请求 - 模型: ${model}`)
        logger.debug(`[Banana] 视频 API 请求 - 模式: ${useStream ? '流式' : '非流式'}`)

        const maxAttempts = this.getMaxRetryLoopAttempts()
        let lastError = null
        let attemptsUsed = 0

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            let currentApiKey = null
            attemptsUsed = attempt
            try {
                currentApiKey = BananaService.getNextApiKey()
                const headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentApiKey}`,
                    'User-Agent': 'Yunzai-Banana-Plugin/1.0.0',
                    'Accept': '*/*',
                    'Host': urlObj.host,
                    'Connection': 'keep-alive'
                }
                const result = await this.streamRequest(apiUrl, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(payload)
                })

                if (!result.success) throw new Error(result.error)

                BananaService.recordKeyUsage(currentApiKey, true)
                const videoUrls = result.videoUrls || []
                const imageFallback = result.imageUrls || []

                const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
                const retryText = attemptsUsed > 1 ? `\n🔁 重试后成功: ${attemptsUsed} 次尝试` : ''
                const summaryMsg = `✅ 视频生成完成（${elapsed}s）\n🤖 模型: ${model}${retryText}`

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
                }

                throw new Error('未找到生成的内容（未解析到视频/图片 URL）')
            } catch (err) {
                lastError = err
                if (currentApiKey) BananaService.recordKeyUsage(currentApiKey, false, err?.message)
                const retryLimit = this.getRetryLimitForError(err)
                if (attempt <= retryLimit && this.shouldRetryError(err)) {
                    const delayMs = this.getRetryDelayForError(err)
                    logger?.debug?.(`[Banana] 视频生成失败，准备重试 ${attempt}/${retryLimit}: ${err?.message || err}`)
                    if (delayMs > 0) await this.sleep(delayMs)
                    continue
                }
                break
            }
        }

        const err = lastError || new Error('生成失败')
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
        let errorMsg = `❌ 生成失败（${elapsed}s）`
        errorMsg += `\n错误: ${err.message}${this.formatRetrySuffix(attemptsUsed)}`
        await e.reply(errorMsg, quoteReply)
    }

    async streamRequest(url, options) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url)
            const isHttps = urlObj.protocol === 'https:'
            const httpModule = isHttps ? https : http
            const logFullResponse = this.config.debug_response_log === true

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
                        if (logFullResponse) logger.debug(`[Banana] 流式响应 HTTP ${res.statusCode}: ${errorData}`)
                        const detail = this.extractApiErrorMessage(errorData)
                        resolve({ success: false, error: `HTTP ${res.statusCode}: ${detail || this.compactResponseText(errorData)}` })
                    })
                    res.on('error', err => {
                        resolve({ success: false, error: `HTTP ${res.statusCode} 响应错误: ${err.message}` })
                    })
                    return
                }

                let buffer = ''
                let finalImageUrls = []
                let finalVideoUrls = []
                let errorMessages = []
                let accumulatedText = ''

                const collectFinalUrlsFromText = () => {
                    if (!accumulatedText) return
                    finalImageUrls = this.extractImagesFromData({ content: accumulatedText }, finalImageUrls)
                    finalVideoUrls = this.extractVideosFromData({ content: accumulatedText }, finalVideoUrls)
                }

                const processJsonChunk = jsonData => {
                    if (!jsonData || typeof jsonData !== 'object') return

                    const apiError = this.extractApiErrorMessage(jsonData, '', false)
                    if (apiError) errorMessages.push(apiError)

                    finalImageUrls = this.extractImagesFromData(jsonData, finalImageUrls)
                    finalVideoUrls = this.extractVideosFromData(jsonData, finalVideoUrls)

                    // 兼容 OpenAI：choices[].delta / choices[].message
                    const choice = jsonData.choices?.[0]
                    const delta = choice?.delta
                    const message = choice?.message
                    const text = this.collectTextFromData(jsonData)
                    if (text) {
                        accumulatedText += text
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
                    if (!data) return 'empty'

                    if (data === '[DONE]') {
                        collectFinalUrlsFromText()
                        if (finalVideoUrls.length > 0 || finalImageUrls.length > 0)
                            resolve({ success: true, imageUrls: finalImageUrls, videoUrls: finalVideoUrls })
                        else if (errorMessages.length > 0)
                            resolve({ success: false, error: `生成失败: ${Array.from(new Set(errorMessages)).join('\n')}` })
                        else {
                            const textDetail = this.compactResponseText(accumulatedText)
                            resolve({ success: false, error: textDetail ? `未找到生成的内容：${textDetail}` : '未找到生成的内容' })
                        }
                        return 'done'
                    }

                    // 标准 SSE: data: {...}
                    try {
                        processJsonChunk(JSON.parse(data))
                        return 'ok'
                    } catch {}

                    return 'skip'
                }

                res.on('data', chunk => {
                    const chunkStr = chunk.toString()
                    if (logFullResponse) logger.debug(`[Banana] 流式响应 chunk: ${chunkStr}`)
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

                    collectFinalUrlsFromText()
                    if (finalVideoUrls.length > 0 || finalImageUrls.length > 0) {
                        resolve({ success: true, imageUrls: finalImageUrls, videoUrls: finalVideoUrls })
                    } else if (errorMessages.length > 0) {
                        resolve({ success: false, error: `生成失败: ${Array.from(new Set(errorMessages)).join('\n')}` })
                    } else {
                        const textDetail = this.compactResponseText(accumulatedText)
                        resolve({ success: false, error: textDetail ? `流式响应异常结束：${textDetail}` : '流式响应异常结束' })
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
                req.destroy(new Error(`request timeout ${requestOptions.timeout}ms`))
                resolve({ success: false, error: `请求超时 (${requestOptions.timeout}ms)` })
            })

            if (options.body) {
                if (Buffer.isBuffer(options.body)) req.write(options.body)
                else req.write(options.body, 'utf8')
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
            const logFullResponse = this.config.debug_response_log === true

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
                        if (logFullResponse) logger.debug(`[Banana] 非流式响应 HTTP ${res.statusCode}: ${errorData}`)
                        const detail = this.extractApiErrorMessage(errorData)
                        resolve({ success: false, error: `HTTP ${res.statusCode}: ${detail || this.compactResponseText(errorData)}` })
                    })
                    res.on('error', err => {
                        resolve({ success: false, error: `HTTP ${res.statusCode} 响应错误: ${err.message}` })
                    })
                    return
                }

                const chunks = []
                res.on('data', chunk => chunks.push(chunk))

                res.on('end', () => {
                    try {
                        const buffer = Buffer.concat(chunks)
                        const responseText = buffer.toString()
                        if (logFullResponse) logger.debug(`[Banana] 非流式响应 HTTP ${res.statusCode}: ${responseText}`)
                        const jsonData = JSON.parse(responseText)

                        let finalImageUrls = []
                        let finalVideoUrls = []
                        finalImageUrls = this.extractImagesFromData(jsonData, finalImageUrls)
                        finalVideoUrls = this.extractVideosFromData(jsonData, finalVideoUrls)
                        if (jsonData.choices?.[0]?.message) {
                            finalImageUrls = this.extractImagesFromData(jsonData.choices[0].message, finalImageUrls)
                            finalVideoUrls = this.extractVideosFromData(jsonData.choices[0].message, finalVideoUrls)
                        }
                        if (Array.isArray(jsonData.data)) {
                            for (const item of jsonData.data) {
                                if (typeof item?.url === 'string') finalImageUrls.push(item.url)
                                if (typeof item?.b64_json === 'string') finalImageUrls.push(`data:image/png;base64,${item.b64_json}`)
                            }
                        }
                        finalImageUrls = Array.from(new Set(finalImageUrls.filter(Boolean)))
                        finalVideoUrls = Array.from(new Set(finalVideoUrls.filter(Boolean)))

                        if (finalVideoUrls.length > 0 || finalImageUrls.length > 0) {
                            resolve({ success: true, imageUrls: finalImageUrls, videoUrls: finalVideoUrls })
                        } else {
                            const errorMsg = this.extractApiErrorMessage(jsonData) || '未找到生成的内容'
                            resolve({ success: false, error: `生成失败: ${errorMsg}` })
                        }
                    } catch (parseErr) {
                        const responseText = Buffer.concat(chunks).toString()
                        if (logFullResponse) logger.debug(`[Banana] 非流式响应解析失败原文: ${responseText}`)
                        const detail = this.compactResponseText(responseText, 500)
                        resolve({ success: false, error: `解析响应失败: ${parseErr.message}${detail ? `；响应: ${detail}` : ''}` })
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
                req.destroy(new Error(`request timeout ${requestOptions.timeout}ms`))
                resolve({ success: false, error: `请求超时 (${requestOptions.timeout}ms)` })
            })

            if (options.body) {
                if (Buffer.isBuffer(options.body)) req.write(options.body)
                else req.write(options.body, 'utf8')
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
            const apiKeyCount = BananaService.getConfiguredApiKeys().length

            await e.reply(`🔧 大香蕉插件调试信息
📊 API Key: 已配置${apiKeyCount}个
🎯 当前队列: ${taskQueue.length}个任务
⚙️ API地址: ${this.config.api_url || '未配置'}
🤖 默认模型: ${this.config.default_model || 'gemini-3-pro-image-preview'}
📡 流式响应: ${this.config.use_stream !== false ? '启用' : '禁用'}`)
        } catch (err) {
            await e.reply(`❌ 调试失败: ${err.message}`)
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

}
