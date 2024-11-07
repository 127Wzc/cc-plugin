
export class exampleBan extends plugin {
    constructor() {
        super({
            /** 功能名称 */
            name: '群聊禁言',
            /** 功能描述 */
            dsc: '群聊禁言',
            /** https://oicqjs.github.io/oicq/#eveAnts */
            event: 'message.group',
            /** 优先级，数字越小等级越高 */
            priority: 10,
            rule: [
                {
                    /** 命令正则匹配 */
                    reg: '^#(qq|QQ)声聊列表',
                    /** 执行方法 */
                    fnc: 'aiCharacters'
                },{
                    /** 命令正则匹配 */
                    reg: '^#(qq|QQ)酥心御姐说.*',
                    /** 执行方法 */
                    fnc: 'sendAiRecord'
                }
            ]
        })
    }

    async aiCharacters(e) {
        let re = await e.group.getAiCharacters(1)
        if(re.status !== "ok"){
            await this.reply([`获取QQ模型失败`])
            return false
        }

        let sendmsg = []
        /**
         * {
            "推荐": ["小新", "猴哥"],
            "搞怪": ["小新", "猴哥"],
            "古风": ["妲己", "四郎", "吕布"],
            "现代": ["霸道总裁", "酥心御姐", "元气少女", "文艺少女", "磁性大叔", "邻家小妹", "低沉男声", "傲娇少女", "爹系男友", "暖心姐姐", "温柔妹妹", "书香少女"]
            }
         */
        re.data.forEach(category => {
            const type = category.type;
            const charactersList = category.characters.map(character => character.character_name);
            sendmsg.push(`${type}: ${charactersList.join(', ')}`, '\n')
        });
        await this.reply(sendmsg)
        return false
    }

    async sendAiRecord(e) {
        let text = e.msg.replace(/^#(qq|QQ)酥心御姐说/, '').trim()
        if(!text) return false
        await e.group.sendGroupAiRecord("lucy-voice-suxinjiejie", "你好")
        return false
    }
}