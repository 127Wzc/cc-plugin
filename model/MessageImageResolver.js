/**
 * 统一从 Yunzai 消息事件中提取已解析的图片链接。
 *
 * 这里只消费适配器/框架已经解析好的结构化字段。
 */
export default class MessageImageResolver {
    static normalizeUrl(value = '') {
        const url = String(value || '').trim()
        if (/^https?:\/\//i.test(url)) return url
        return ''
    }

    static addUnique(list, value) {
        const url = this.normalizeUrl(value)
        if (url && !list.includes(url)) list.push(url)
    }

    static getSegmentImageUrl(segment = {}) {
        if (!segment || typeof segment !== 'object') return ''
        const candidates = [
            segment.url,
            segment.file,
            segment.path,
            segment.src,
            segment.data?.url,
            segment.data?.file,
            segment.data?.path,
            segment.data?.src
        ]

        for (const candidate of candidates) {
            const url = this.normalizeUrl(candidate)
            if (url) return url
        }
        return ''
    }

    static collectFromSegments(segments = []) {
        const urls = []
        for (const segment of Array.isArray(segments) ? segments : []) {
            if (segment?.type !== 'image' && segment?.type !== 'mface') continue
            this.addUnique(urls, this.getSegmentImageUrl(segment))
        }
        return urls
    }

    static collectCurrent(e = {}) {
        const urls = []
        for (const url of Array.isArray(e.img) ? e.img : []) this.addUnique(urls, url)
        for (const url of this.collectFromSegments(e.message)) this.addUnique(urls, url)
        return urls
    }

    static async getQuotedMessage(e = {}) {
        if (e.getReply) {
            try {
                const source = await e.getReply()
                if (source) return source
            } catch (err) {
                logger?.debug?.(`[MessageImageResolver] e.getReply 获取引用消息失败: ${err?.message || err}`)
            }
        }

        if (!e.source) return null

        try {
            if (e.group?.getChatHistory) {
                return (await e.group.getChatHistory(e.source.seq, 1))?.pop() || null
            }
            if (e.friend?.getChatHistory) {
                return (await e.friend.getChatHistory(e.source.time, 1))?.pop() || null
            }
        } catch (err) {
            logger?.debug?.(`[MessageImageResolver] e.source 获取引用消息失败: ${err?.message || err}`)
        }

        return null
    }

    static async collectQuoted(e = {}) {
        const source = await this.getQuotedMessage(e)
        return this.collectFromSegments(source?.message)
    }

    static async resolve(e = {}, { current = true, quoted = true, maxImages = 3 } = {}) {
        const urls = []

        if (current) {
            for (const url of this.collectCurrent(e)) this.addUnique(urls, url)
        }

        if (quoted) {
            for (const url of await this.collectQuoted(e)) this.addUnique(urls, url)
        }

        const limit = Number.isFinite(Number(maxImages)) ? Math.max(1, Math.floor(Number(maxImages))) : 3
        if (urls.length > limit) {
            logger?.debug?.(`[MessageImageResolver] 输入图片超出${limit}张，已截取前${limit}张`)
        }
        return urls.slice(0, limit)
    }
}
