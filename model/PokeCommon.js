import Config from "../components/Cfg.js"

// 缓存所有表情ID
let poke_data = null;

// 获取所有表情ID并返回随机值
function getPokeDataByKey(name) {
    let dataArray = [];
    
    // 如果已经有缓存，直接返回缓存的结果
    if (poke_data) {
        if(poke_data[name]){
            dataArray = poke_data[name].data;
        }else{
            return [];
        }
    } else {
        poke_data = Config.getDataJson("poke_words");
        
        // 检查返回的数据中是否有指定的键
        if(poke_data && poke_data[name]){
            dataArray = poke_data[name].data;
        }else{
            return [];
        }
    }
    
    // 获取对应的 name 值，如果没有则使用传入的 name
    const botName = poke_data[name]?.name || name;
    
    // 替换占位符 {name} 为实际的 name 值
    return dataArray.map(text => {
        if (typeof text === 'string') {
            return text.replace(/{name}/g, botName);
        }
        return text;
    });
}

export { getPokeDataByKey } 