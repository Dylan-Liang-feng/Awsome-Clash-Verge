export type AppCatalog = Record<string, string | string[]>
export type RuleTarget = { label: string; conditions: string[] }
export type RuleIntent = { target: string; route: 'direct' | 'proxy' }
const sites: Record<string, string[]> = {
  Gemini: [
    'DOMAIN,gemini.google.com',
    'DOMAIN,gemini.gstatic.com',
    'DOMAIN,generativelanguage.googleapis.com',
  ],
  Gemini网页: ['DOMAIN,gemini.google.com', 'DOMAIN,gemini.gstatic.com'],
  Claude桌面版: ['PROCESS-NAME,Claude.exe'],
  ChatGPT桌面版: ['PROCESS-NAME,ChatGPT.exe'],
  Claude: [
    'PROCESS-NAME,Claude.exe',
    'DOMAIN-SUFFIX,claude.ai',
    'DOMAIN-SUFFIX,anthropic.com',
    'DOMAIN-SUFFIX,claude.com',
    'DOMAIN-SUFFIX,claude.app',
    'DOMAIN-SUFFIX,claudeusercontent.com',
    'DOMAIN-SUFFIX,claudemcpcontent.com',
  ],
  ChatGPT: ['PROCESS-NAME,ChatGPT.exe', 'DOMAIN-SUFFIX,chatgpt.com'],
  Codex: ['PROCESS-NAME,codex.exe'],
  ChatGPT网页: ['DOMAIN-SUFFIX,chatgpt.com'],
  Claude网页: [
    'DOMAIN-SUFFIX,claude.ai',
    'DOMAIN-SUFFIX,claudeusercontent.com',
  ],
  哔哩哔哩: ['DOMAIN-SUFFIX,bilibili.com'],
  B站: ['DOMAIN-SUFFIX,bilibili.com'],
  抖音: ['DOMAIN-SUFFIX,douyin.com'],
}

export const knownServiceNames = Object.keys(sites)

export function findTargets(text: string, apps: AppCatalog): RuleTarget[] {
  const result = new Map<string, string[]>()
  let folded = text.replace(/(?:[a-z0-9-]+\.)+[a-z]{2,63}/gi, ' ').toLowerCase()
  for (const [label, conditions] of Object.entries(sites).sort(
    ([a], [b]) => b.length - a.length,
  )) {
    if (folded.includes(label.toLowerCase())) {
      result.set(label, conditions)
      folded = folded.replaceAll(label.toLowerCase(), ' ')
    }
  }
  for (const [label, folder] of Object.entries(apps).sort(
    ([a], [b]) => b.length - a.length,
  )) {
    if (!folded.includes(label.toLowerCase())) continue
    folded = folded.replaceAll(label.toLowerCase(), ' ')
    if (Array.isArray(folder)) {
      result.set(label, folder)
      continue
    }
    if (/[,\r\n]/.test(folder)) continue
    const literal = folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result.set(label, ['PROCESS-PATH-REGEX,(?i)^' + literal + '\\\\'])
  }
  for (const match of text.matchAll(
    /(?<![a-z0-9_.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?![a-z0-9_.-])/gi,
  )) {
    const name = match[0].toLowerCase()
    result.set(match[0], [
      (name.endsWith('.exe') ? 'PROCESS-NAME,' : 'DOMAIN,') + name,
    ])
  }
  return [...result].map(([label, conditions]) => ({ label, conditions }))
}

export function compileIntents(
  raw: unknown,
  targets: RuleTarget[],
  group: string,
) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 40)
    throw Error('请明确写出网站域名或已安装的应用，以及直连或代理。')
  const selected = new Map<string, string>()
  for (const entry of raw) {
    const item = targets.find((t) => t.label === entry?.target)
    if (!item || !['direct', 'proxy'].includes(entry?.route))
      throw Error('生成结果与可识别的目标不符。')
    if (entry.route === 'proxy' && (!group || /[,\r\n]/.test(group)))
      throw Error('请选择当前订阅中的代理组。')
    const policy = entry.route === 'direct' ? 'DIRECT' : group
    for (const condition of item.conditions) {
      if (selected.has(condition) && selected.get(condition) !== policy)
        throw Error('同一目标同时要求直连和代理，请明确后重试。')
      selected.set(condition, policy)
    }
  }
  return [...selected].map(([condition, policy]) => condition + ',' + policy)
}
