export type ApiSettings = { address: string; model: string; prompt: string }
const storageKey = 'rule-model-api-v1'
const previousPrompt =
  '你是我的 Clash 分流助手。把整句自然语言转换为准确的应用和网站路由任务。理解口语和否定，优先使用用户指定的范围；如果无法准确表达需求，请用中文指出需要澄清的部分。'
const defaultPrompt =
  '你负责根据整句需求作出分流判断。先理解用户要处理的对象、方向、范围和例外，缺少事实就使用本机或官网查询。取得证据后再决定精确主机或子域范围；只在证据不足或意图真正有歧义时请用户澄清。请用中文说明范围。'
export function readApiSettings(): ApiSettings {
  const defaults = { address: '', model: '', prompt: defaultPrompt }
  try {
    const cfg = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (cfg && Object.keys(defaults).every((k) => typeof cfg[k] === 'string'))
      return {
        address: cfg.address,
        model: cfg.model,
        prompt: cfg.prompt === previousPrompt ? defaultPrompt : cfg.prompt,
      }
  } catch {
    /* Fresh settings are usable even if the old value cannot be read. */
  }
  return defaults
}
export function saveApiSettings(value: ApiSettings) {
  localStorage.setItem(storageKey, JSON.stringify(value))
}
export function clearApiSettings() {
  localStorage.removeItem(storageKey)
}
