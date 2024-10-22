import fetch from "node-fetch"

export class exampleBan extends plugin {
    constructor() {
        super({
            /** 功能名称 */
            name: 'qq相关api',
            /** 功能描述 */
            dsc: 'qq注册时间',
            /** https://oicqjs.github.io/oicq/#eveAnts */
            event: 'message',
            /** 优先级，数字越小等级越高 */
            priority: 1,
            rule: [
                {
                    /** 命令正则匹配 */
                    reg: '^#(qq|QQ)注册时间.*',
                    /** 执行方法 */
                    fnc: 'registerTime'
                }
            ]
        })
    }

    async registerTime(e) {

        let qq = this.e.at || this.e.message.find(item => item.type == "at")?.qq || (this.e.msg.match(/\d+/)?.[0] || "") || this.e.user_id
        qq = Number(qq) || String(qq)

        logger.debug(`当前查询的qq:${qq}`)
        let url = `https://api.lolimi.cn/API/qqdj/a.php?qq=${qq}`
        let re = await fetch(url).then(response => response.json()).catch(error => logger.error(error));

        if (re && re.status === 'ok') {
            let regTime = re.data?.reg_time || '';
            let qqLevel = re.data?.qqLevel || '';
            let msg = [
                `QQ：${qq}\n注册时间:${regTime}\n等级：${qqLevel}`
            ];
            this.reply(msg);
        }
        
        return true;
    }
}