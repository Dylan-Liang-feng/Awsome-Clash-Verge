import type { WebsiteResult } from '@/services/bindings'

import {
  findTargets,
  knownServiceNames,
  type AppCatalog,
} from './natural-rules'
import { groundedTarget, type RequestPlan } from './routing-coverage'

export function modelRequest(
  instruction: string,
  apps: Record<string, string>,
  website?: WebsiteResult,
  localApps?: { name: string; program: string }[],
) {
  return JSON.stringify({
    instruction,
    ...(localApps?.length ? { localApps } : {}),
    ...(website
      ? {
          website: {
            name: website.name,
            hosts: website.hosts,
            source: website.source,
          },
        }
      : {}),
    catalog: [...knownServiceNames, 'Claude Code'],
    mentioned: findTargets(instruction, apps).map((t) => t.label),
  })
}
const fields = new Set([
  'target',
  'quote',
  'route',
  'process',
  'subdomains',
  'otherwise',
  'resources',
  'exclusive',
  'group',
  'webSearch',
  'bypassTun',
  'directory',
])
const exe = /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.exe$/i
const policy = (v: unknown) =>
  v === 'proxy' ? '走代理' : v === 'direct' ? '直连' : null
const bad = '模型返回的规则缺少依据或范围不完整，未添加规则。'

export function apiPlan(
  raw: string,
  input: string,
  apps: AppCatalog,
  cli: [string, string] | null,
  groups: string[],
  website?: WebsiteResult,
  scopes: Record<string, { label: string; conditions: string[] }> = {},
): RequestPlan {
  let result
  try {
    result = JSON.parse(
      raw.trim().replace(/^\x60{3}(?:json)?\s*([\s\S]*?)\s*\x60{3}$/i, '$1'),
    )
  } catch {
    throw Error('模型未返回可读取的规则 JSON，请重试或调整提示词。')
  }
  if (result?.clarification) {
    throw Error(
      typeof result.clarification === 'string'
        ? result.clarification.slice(0, 600)
        : bad,
    )
  }
  if (
    !result ||
    Object.keys(result).some((k) => k !== 'rules') ||
    !Array.isArray(result.rules) ||
    !result.rules.length ||
    result.rules.length > 12
  )
    throw Error(bad)
  const merged: RequestPlan = {
    instruction: input,
    jobs: [],
    requiresLookup: false,
    notes: [],
  }
  const mentioned = findTargets(input, apps).map((t) => t.label.toLowerCase())
  const known = [
    ...knownServiceNames,
    ...Object.keys(apps),
    'Claude Code',
    ...mentioned,
  ]
  const recognised = new Set<string>()
  for (const r of result.rules) {
    if (
      !r ||
      typeof r !== 'object' ||
      Object.keys(r).some((k) => !fields.has(k)) ||
      typeof r.target !== 'string' ||
      typeof r.quote !== 'string' ||
      !r.quote.trim() ||
      !input.includes(r.quote) ||
      !policy(r.route)
    )
      throw Error(bad)
    for (const k of [
      'subdomains',
      'resources',
      'exclusive',
      'webSearch',
      'bypassTun',
    ])
      if (k in r && typeof r[k] !== 'boolean') throw Error(bad)
    const namedTarget = website?.hosts.includes(r.target.trim().toLowerCase())
      ? website.name
      : r.target
    const requested = namedTarget
      .trim()
      .replace(
        /\s*(?:的?网页(?:端|版)?|官网|官方网站|web\s*(?:site|app))$/i,
        '',
      )
      .trim()
    const webIntent =
      r.directory === 'research' ||
      r.webSearch === true ||
      website?.name === requested
    const isCatalog = knownServiceNames.some(
      (n) => n.toLowerCase() === requested.toLowerCase(),
    )
    const lookup =
      webIntent &&
      !isCatalog &&
      (!Object.keys(apps).some(
        (a) => a.toLowerCase() === requested.toLowerCase(),
      ) ||
        /网页|官网|网站|web/i.test(input)) &&
      requested.toLowerCase() !== 'claude code' &&
      !requested.includes('.') &&
      !requested.includes('@') &&
      /^[\p{L}\p{N}][\p{L}\p{N} &·+-]{1,59}$/u.test(requested) &&
      !/我的|帐号|账号|密码|内网|公司内部|本机|直连|代理|节点|帮我|搜索|https/i.test(
        requested,
      ) &&
      r.quote.toLowerCase().includes(requested.toLowerCase())
        ? requested
        : undefined
    if (
      r.directory !== undefined &&
      (!lookup || !['research', 'general'].includes(r.directory))
    )
      throw Error(bad)
    if (r.webSearch && !lookup && !isCatalog)
      throw Error('网站检索需要原句中的公开产品名，请提供服务名或官网域名。')
    const target =
      lookup ??
      known.find((n) => n.toLowerCase() === r.target.trim().toLowerCase())
    if (!target || target.length > 253 || /[,\r\n]/.test(target))
      throw Error('未核对到模型给出的应用或域名，请提供实际目标。')
    if (
      r.process !== undefined &&
      (typeof r.process !== 'string' || !exe.test(r.process))
    )
      throw Error(bad)
    const scope =
      typeof r.process === 'string'
        ? scopes[r.quote + '\n' + r.process.toLowerCase()]
        : undefined
    if (r.process) {
      const proc = r.process.toLowerCase()
      const alias: Record<string, RegExp> = {
        'msedge.exe': /edge|微软浏览器/i,
        'chrome.exe': /chrome|谷歌浏览器/i,
        'firefox.exe': /firefox|火狐/i,
      }
      if (!scope && !mentioned.includes(proc) && !alias[proc]?.test(input))
        throw Error('请写明限制范围的浏览器或 .exe 进程。')
      if (scope) recognised.add(scope.label.toLowerCase())
      recognised.add(proc)
    }
    if (r.otherwise !== undefined && (!r.process || !policy(r.otherwise)))
      throw Error(bad)
    if (
      r.group !== undefined &&
      (r.route !== 'proxy' ||
        typeof r.group !== 'string' ||
        !groups.includes(r.group) ||
        !input.includes(r.group))
    )
      throw Error('模型指定的策略组与需求或订阅不符，请在界面选择代理组。')
    // A web entity may have a requested scope before its DNS name is known.
    const normalized = target.replace(/网页$/, '')
    let service =
      lookup ??
      (['Claude', 'Gemini', 'ChatGPT'].includes(normalized)
        ? normalized
        : undefined)
    const resolved = lookup
      ? { label: lookup, conditions: [] }
      : groundedTarget(target, apps, cli, r, merged.notes)
    if (!lookup && !resolved.conditions.some((c) => c.startsWith('DOMAIN')))
      service = undefined
    if (r.resources && !service) throw Error('未找到可核对附加资源的服务。')
    const job: RequestPlan['jobs'][number] = {
      target: resolved,
      phrase: r.quote,
      route: r.route,
      browser: r.process?.toLowerCase(),
      otherwise: r.otherwise,
      service,
      lookup,
      research: r.directory === 'research',
      includeSubdomains: r.subdomains === true,
      reviewResources: r.resources === true,
    }
    if (r.bypassTun) {
      if (
        !/tun|虚拟网卡/i.test(input) ||
        r.route !== 'direct' ||
        r.process ||
        r.otherwise ||
        scope ||
        (!lookup && !resolved.conditions.every((c) => c.startsWith('DOMAIN')))
      )
        throw Error('完全绕过 TUN 仅适用于遵循系统 PAC 的浏览器网站访问。')
      job.bypassTun = true
      merged.notes.push(
        '浏览器绕过虚拟网卡需要规则模式、TUN 和专用系统 PAC；保存后重新打开浏览器以重读 PAC。',
      )
    }
    job.group = r.group
    if (scope) job.applicationConditions = scope.conditions
    recognised.add(target.toLowerCase())
    if (lookup)
      for (const name of mentioned)
        if (
          lookup.toLowerCase().includes(name) &&
          !input
            .toLowerCase()
            .replaceAll(lookup.toLowerCase(), '')
            .includes(name)
        )
          recognised.add(name)
    if (target === 'B站' || target === '哔哩哔哩') {
      recognised.add('b站')
      recognised.add('哔哩哔哩')
    }
    if (target === 'Claude Code') recognised.add('claude')
    if (/网页|桌面版/.test(target))
      recognised.add(target.replace(/网页|桌面版/, '').toLowerCase())
    merged.jobs.push(job)
    merged.requiresLookup ||= r.resources === true
  }
  if (mentioned.some((t) => !recognised.has(t)))
    throw Error('模型遗漏了原句中的目标，未添加规则。')
  const services = [
    ...new Set(merged.jobs.map((j) => j.service).filter(Boolean)),
  ]
  if (services.length === 1) merged.service = services[0]
  return merged
}
