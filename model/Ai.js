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
    let aiConfig = Config.qqConfig.ai
    let character_id = aiConfig.characterId ? aiConfig.characterId : "lucy-voice-laibixiaoxin"
    if(aiConfig.type == 0){
        character_id = Ai.getRandomAiCharacters()
    }
    await e.group.sendGroupAiRecord(character_id, message)
    return true
  }
  
  /**
   * 获取qq音色map 角色名：character_id
   * @returns 
   */
  static getAiCharacterMap() {
    return Config.getDataJson("ai-characters").flatMap(category => category.characters).reduce((map, character) => {
      map.set(character.character_name, character.character_id);
      return map;
    }, new Map())
  }
}