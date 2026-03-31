import path from "node:path"
import fs from "node:fs/promises"
import {
  buildCommandKnowledgeBase,
  buildCozeKnowledgeBase,
  buildCozeKnowledgeCsv,
  buildCozeKnowledgeText,
} from "../model/CommandKnowledgeBase.js"

export class commandKnowledgeBase extends plugin {
  constructor() {
    super({
      name: "[cc-plugin] Command Knowledge Base",
      dsc: "导出 AI 指令知识库 JSON",
      event: "message",
      priority: 50,
      rule: [
        {
          reg: "^#cc导出指令json$",
          fnc: "exportCommandKnowledgeBase",
          permission: "master",
        },
      ],
    })
  }

  async exportCommandKnowledgeBase() {
    const outputDir = path.join(process.cwd(), "data", "cc-plugin")
    const outputFile = path.join(outputDir, "command-kb.latest.json")
    const cozeJsonFile = path.join(outputDir, "command-kb.coze.json")
    const cozeCsvFile = path.join(outputDir, "command-kb.coze.csv")
    const cozeTxtFile = path.join(outputDir, "command-kb.coze.txt")

    try {
      const knowledgeBase = await buildCommandKnowledgeBase()
      const cozeKnowledge = buildCozeKnowledgeBase(knowledgeBase)
      const cozeCsv = buildCozeKnowledgeCsv(knowledgeBase)
      const cozeText = buildCozeKnowledgeText(knowledgeBase)
      await fs.mkdir(outputDir, { recursive: true })
      await fs.writeFile(outputFile, JSON.stringify(knowledgeBase, null, 2), "utf8")
      await fs.writeFile(cozeJsonFile, JSON.stringify(cozeKnowledge, null, 2), "utf8")
      await fs.writeFile(cozeCsvFile, cozeCsv, "utf8")
      await fs.writeFile(cozeTxtFile, cozeText, "utf8")

      const sent = await this.trySendFile(outputFile)
      if (sent) {
        await this.reply(
          [
            "已额外生成 Coze 导入文件：",
            `JSON: ${cozeJsonFile}`,
            `CSV: ${cozeCsvFile}`,
            `TXT: ${cozeTxtFile}`,
          ].join("\n"),
        )
        return true
      }

      const url = await Bot.fileToUrl(outputFile, { name: path.basename(outputFile) })
      await this.reply(
        [
          `指令知识库已导出：${url}`,
          `Coze JSON：${cozeJsonFile}`,
          `Coze CSV：${cozeCsvFile}`,
          `Coze TXT：${cozeTxtFile}`,
        ].join("\n"),
      )
      return true
    } catch (err) {
      logger.error("[cc-plugin] 导出指令知识库失败")
      logger.error(err)
      await this.reply(`导出失败：${err.message || err}`)
      return true
    }
  }

  async trySendFile(filePath) {
    try {
      if (this.e.group?.sendFile) {
        await this.e.group.sendFile(filePath)
        return true
      }

      if (this.e.friend?.sendFile) {
        await this.e.friend.sendFile(filePath)
        return true
      }
    } catch (err) {
      logger.warn(`[cc-plugin] 发送知识库文件失败，将回退到链接模式: ${err.message || err}`)
    }

    return false
  }
}
