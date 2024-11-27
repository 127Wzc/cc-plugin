import Config from "../components/Cfg.js";
import common from "../../../lib/common/common.js";

export class exampleBan extends plugin {
  constructor() {
    super({
      /** 功能名称 */
      name: "主动戳别人",
      /** 功能描述 */
      dsc: "主动戳别人",
      /** https://oicqjs.github.io/oicq/#eveAnts */
      event: "message.group",
      /** 优先级，数字越小等级越高 */
      priority: 1,
      rule: [
        {
          /** 命令正则匹配 */
          reg: "^#戳他",
          /** 执行方法 */
          fnc: "poke",
        },
      ],
    });
  }

  async poke(e) {
    //过滤主人 可以执行

    let num = e.msg.replace(/^#戳他/, "").trim().split("x")[1];
    if (Config.masterQQ.includes(e.user_id)) {
      if (e.at) {
        if (num && /^\d+$/.test(num)) {
          //如果不服务0-10的范围 重置为1
          if(num < 0 || num > 10){
            num = 1
          }
          for (let i = 0; i < num; i++) {
            await e.group.pokeMember(e.at);
            await common.sleep(500);
          }
        } else {
          e.group.pokeMember(e.at);
        }
      }
    }
    return false;
  }
}
