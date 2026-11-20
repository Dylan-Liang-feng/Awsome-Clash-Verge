import type { AppEvidence } from '@/services/bindings'

import { knownServiceNames, type AppCatalog } from './natural-rules'

const fold = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\.exe$/i, '')
    .replace(/\s*[(（](?:x64|x86|64[- ]?bit|32[- ]?bit|64位|32位)[)）]$/i, '')
    .replace(/[\s._-]+/g, '')
const leaf = (s: string) => s.split('\\').pop() ?? ''
const equivalents = [
  ['微信', 'Weixin', 'WeChat'],
  ['QQ', '腾讯QQ', 'QQNT', '扣扣'],
]
function labels(app: AppEvidence) {
  const names = [...new Set([...app.names, leaf(app.path)])]
  const keys = new Set(names.map(fold))
  for (const family of equivalents)
    if (family.some((n) => keys.has(fold(n)))) names.push(...family)
  return [...new Set(names)].filter(
    (n) => n.length >= 2 && n.length <= 90 && !/[,\r\n]/.test(n),
  )
}
function unique(items: AppEvidence[]) {
  return [...new Map(items.map((a) => [a.path.toLowerCase(), a])).values()]
}
function matches(terms: string[], evidence: AppEvidence[]) {
  const keys = new Set(terms.map(fold))
  return unique(
    evidence.filter((a) => labels(a).some((n) => keys.has(fold(n)))),
  )
}
function mentioned(text: string, app: AppEvidence) {
  const escaped = (n: string) => n.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&')
  return labels(app)
    .filter(
      (n) =>
        !n.toLowerCase().endsWith('.exe') &&
        new RegExp('(?<![a-z0-9])' + escaped(n) + '(?![a-z0-9.])', 'i').test(
          text,
        ),
    )
    .sort((a, b) => b.length - a.length)[0]
}
export function appHints(text: string, evidence: AppEvidence[]) {
  return unique(evidence)
    .flatMap((a) => {
      const name = mentioned(text, a)
      return name ? [{ name, program: leaf(a.path) }] : []
    })
    .slice(0, 24)
}
function paths(app: AppEvidence, folders: Record<string, string>) {
  const dir = app.path.slice(0, app.path.lastIndexOf('\\'))
  const root =
    Object.entries(folders).find(
      ([name, f]) =>
        labels(app).some((n) => fold(n) === fold(name)) &&
        app.path.toLowerCase().startsWith(f.toLowerCase() + '\\'),
    )?.[1] ?? (fold(leaf(app.path)) === fold(leaf(dir)) ? dir : undefined)
  const valid = (p: string) => /^[a-z]:\\[^,\r\n]+\.exe$/i.test(p)
  if (!valid(app.path)) throw Error('本机程序路径无法表示为规则。')
  const main = root
    ? 'PROCESS-PATH-REGEX,(?i)^' +
      root.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&') +
      '\\\\'
    : 'PROCESS-PATH,' + app.path
  const helpers = app.helpers.filter(
    (p) =>
      valid(p) &&
      p.toLowerCase() !== app.path.toLowerCase() &&
      (!root || !p.toLowerCase().startsWith(root.toLowerCase() + '\\')),
  )
  return [main, ...new Set(helpers.map((p) => 'PROCESS-PATH,' + p))]
}

type Choose = (label: string, candidates: AppEvidence[]) => Promise<AppEvidence>
export async function matchLocalApps(
  raw: string,
  text: string,
  folders: Record<string, string>,
  evidence: AppEvidence[],
  publicNames: (term: string) => Promise<string[]>,
  choose: Choose,
) {
  const apps: AppCatalog = { ...folders }
  const notes: string[] = []
  const scopes: Record<string, { label: string; conditions: string[] }> = {}
  const hints = appHints(text, evidence)
  for (const label of new Set(hints.map((h) => h.name))) {
    const hits = matches([label], evidence)
    if (hits.length === 1) apps[label] = paths(hits[0], folders)
    else if (hits.length > 1 && !apps[label]) apps[label] = []
  }
  let reply
  try {
    reply = JSON.parse(
      raw.trim().replace(/^\x60{3}(?:json)?\s*([\s\S]*?)\s*\x60{3}$/i, '$1'),
    )
  } catch {
    return { raw, apps, notes, scopes }
  }
  if (
    reply?.clarification ||
    !Array.isArray(reply?.rules) ||
    reply.rules.length > 12
  )
    return { raw, apps, notes, scopes }
  const searched = new Map<string, string[]>()
  for (const rule of reply.rules) {
    if (
      !rule ||
      typeof rule.target !== 'string' ||
      typeof rule.quote !== 'string' ||
      !text.includes(rule.quote)
    )
      continue
    const target = rule.target.trim()
    if (
      typeof rule.process === 'string' &&
      !text.toLowerCase().includes(rule.process.toLowerCase())
    ) {
      const hits = matches([rule.process], evidence).filter((a) =>
        mentioned(rule.quote, a),
      )
      if (hits.length) {
        const a = hits.length === 1 ? hits[0] : await choose(rule.process, hits)
        if (!hits.includes(a)) throw Error('未选择匹配的软件。')
        rule.process = leaf(a.path).toLowerCase()
        scopes[rule.quote + '\n' + rule.process] = {
          label: mentioned(rule.quote, a)!,
          conditions: paths(a, folders),
        }
      }
    }
    const appName = rule.app
    const suggestions = rule.appNames ?? []
    if (
      appName !== undefined &&
      (typeof appName !== 'string' ||
        !appName.trim() ||
        appName.length > 80 ||
        !rule.quote.toLowerCase().includes(appName.toLowerCase()))
    )
      throw Error('模型未指出原句中的软件称呼，请重新生成。')
    if (
      !Array.isArray(suggestions) ||
      suggestions.length > 6 ||
      suggestions.some(
        (n) =>
          typeof n !== 'string' ||
          !n.trim() ||
          n.length > 90 ||
          /[,\\/\r\n]/.test(n),
      )
    )
      throw Error('软件候选名称无效。')
    delete rule.app
    delete rule.appNames
    // Web entry discovery and literal host/executable rules retain their original scope.
    if (
      rule.webSearch ||
      /网页(?:端|版)?|官网|网站/i.test(target) ||
      knownServiceNames.some((n) => fold(n) === fold(target)) ||
      /^claude\s*code$/i.test(target)
    )
      continue
    if (
      /\.[a-z]{2,}$/i.test(target) &&
      (!/\.exe$/i.test(target) ||
        text.toLowerCase().includes(target.toLowerCase()))
    )
      continue
    const term =
      appName ??
      (rule.quote.toLowerCase().includes(target.toLowerCase())
        ? target
        : undefined)
    const direct = term ? matches([term], evidence) : []
    const proposed = matches([target, ...suggestions], evidence)
    let found = direct.length ? direct : proposed
    if (direct.length > 1 && proposed.length) {
      const overlap = direct.filter((a) => proposed.includes(a))
      if (overlap.length) found = overlap
    }
    if (
      !found.length &&
      appName &&
      !Object.keys(folders).some((k) => fold(k) === fold(target)) &&
      /^[\p{L}\p{N}][\p{L}\p{N} &·+-]{1,59}$/u.test(appName) &&
      !/内网|公司内部|账号|密码/.test(appName)
    ) {
      let names = searched.get(appName)
      if (!names) {
        if (searched.size >= 3)
          throw Error('请每次核对最多三个需要联网查别名的软件。')
        try {
          names = await publicNames(appName)
        } catch {
          names = []
        }
        searched.set(appName, names)
      }
      found = matches(names, evidence)
      if (found.length)
        notes.push('已用公开软件别名核对「' + appName + '」的本机文件。')
    }
    if (!found.length) {
      const folderName = Object.keys(folders).find((k) =>
        [target, appName, ...suggestions].some(
          (n) => typeof n === 'string' && fold(n) === fold(k),
        ),
      )
      if (folderName && appName) {
        rule.target = appName
        apps[appName] = folders[folderName]
        continue
      }
      if (appName || /\.exe$/i.test(target))
        throw Error(
          '还没在本机确认「' +
            (appName ?? target) +
            '」。可以打开该软件后重试，或使用开始菜单上显示的名称。',
        )
      continue
    }
    const grounded = found.filter((a) => mentioned(rule.quote, a))
    if (!term && !grounded.length)
      throw Error('模型给出的软件与原句没有可核对的对应关系。')
    const candidates = grounded.length ? grounded : found
    const app =
      candidates.length === 1
        ? candidates[0]
        : await choose(term ?? target, candidates)
    if (!candidates.includes(app)) throw Error('未选择匹配的软件。')
    const label = mentioned(rule.quote, app) ?? term
    if (!label || /[,\\/\r\n]/.test(label))
      throw Error('无法核实原句中的软件名称。')
    const conditions = paths(app, folders)
    apps[label] = conditions
    rule.target = label
    notes.push(
      label +
        ' → ' +
        leaf(app.path) +
        (conditions.length > 1
          ? '（含 ' +
            conditions
              .slice(1)
              .map((c) => leaf(c))
              .join('、') +
            '）'
          : '') +
        '。',
    )
  }
  return {
    raw: JSON.stringify(reply),
    apps,
    notes: [...new Set(notes)],
    scopes,
  }
}
