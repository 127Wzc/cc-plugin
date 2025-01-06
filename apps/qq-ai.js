import Config from "../components/Cfg.js";
import Ai from "../model/Ai.js";

let characterMap = Ai.getAiCharacterMap();
export class exampleBan extends plugin {
  constructor() {
    let option = {
      /** 功能名称 */
      name: "群聊禁言",
      /** 功能描述 */
      dsc: "群聊禁言",
      /** https://oicqjs.github.io/oicq/#eveAnts */
      event: "message.group",
      /** 优先级，数字越小等级越高 */
      priority: 10,
      rule: [
        {
          /** 命令正则匹配 */
          reg: "^#(更新)?(qq|QQ)?声聊列表",
          /** 执行方法 */
          fnc: "aiCharacters",
        },
        {
          /** 命令正则匹配 */
          reg: "^#?(qq|QQ)?声聊说.*",
          /** 执行方法 */
          fnc: "sendAiRecord",
        },
        {
          /** 命令正则匹配 */
          reg: "^#?(qq|QQ)?声聊设置角色.*",
          /** 执行方法 */
          fnc: "setAiRecordRole",
        }
      ],
    };
    characterMap.keys().forEach((key) => {
      let reg = `^#?${key}说.*`;
      option.rule.push({
        /** 命令正则匹配 */
        reg,
        /** 执行方法 */
        fnc: "voice",
      });
    });

    super(option);
  }

  async voice(e) {
    let msg = e.msg.replace("#", "");

    // 找到第一个“说”字的位置
    let firstIndex = msg.indexOf("说");

    // 使用 substring 方法从字符串开始到第一个“说”字后面的内容
    let name = msg.substring(0, firstIndex);
    let current = characterMap.get(name);
    const text = msg.substring(firstIndex+1);
    if (current && text) {
      if (typeof e.group.sendGroupAiRecord === 'function') {
        await e.group.sendGroupAiRecord(current, text);
      }
      return true;
    }
    return false
  }

  async aiCharacters(e) {
    if (e.msg.includes("更新")) {
      if (!Config.masterQQ.includes(e.user_id)) return true;
      let re = await e.group.getAiCharacters(1);
      if (re.status !== "ok") {
        await this.reply([`获取QQ模型失败`]);
        return true;
      }
      if (re.data) {
        Config.writeDataJson("ai-characters", re.data);
      }
    }

    let aiData = Config.getDataJson("ai-characters");
    let sendmsg = [];
    aiData.forEach((category) => {
      const type = category.type;
      const charactersList = category.characters.map(
        (character) => character.character_name
      );
      sendmsg.push(`${type}: ${charactersList.join(", ")}`, "\n");
    });
    await this.reply(sendmsg);
    return true;
  }

  async sendAiRecord(e) {
    let text = e.msg.replace(/^#(qq|QQ)?声聊说/, "").trim();
    if (!text) return false;
    return await Ai.sendRecordByType(e, text);
  }

  async setAiRecordRole(e) {
    if (!Config.masterQQ.includes(e.user_id)) return true;
    let roleName = e.msg.replace(/^#(qq|QQ)?声聊设置角色/, "").trim();
    let aiData = Config.getDataJson("ai-characters");
    let targetCharacter;
    for (const category of aiData) {
      // 查找特定的character_name
      targetCharacter = category.characters.find(
        (character) => character.character_name === roleName
      );
      // 如果找到了特定的character_name
      if (targetCharacter) {
        break;
      }
    }
    if (targetCharacter) {
      Config.modify("qqConfig", "ai.characterId", targetCharacter.character_id);
      await e.group.sendGroupAiRecord(
        targetCharacter.character_id,
        `已修改角色为: ${targetCharacter.character_name}`
      );
    }
    return false;
  }
}
