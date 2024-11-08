import Config from "../components/Cfg.js"

export default class Ai {
  static getRandomAiCharacters() {
    let aiData = Config.getDataJson("ai-characters");
    let allCharacters = [];

    aiData.forEach(category => {
      allCharacters = allCharacters.concat(category.characters.map(character => character.character_id));
    });

    if (allCharacters.length > 0) {
      const randomIndex = Math.floor(Math.random() * allCharacters.length); // 生成一个随机索引
      return allCharacters[randomIndex]; // 返回随机选择的元素
    } else {
      return null; // 如果数组为空，则返回null或者其他默认值
    }
  }

  static async sendRecordByType(e, message){
    let aiConfig = Config.qqAiConfig.ai
    let character_id = aiConfig.characterId ? aiConfig.characterId : "lucy-voice-laibixiaoxin"
    if(aiConfig.type == 0){
        character_id = Ai.getRandomAiCharacters()
    }
    await e.group.sendGroupAiRecord(character_id, message)
    return true
  }
}