import { parse } from 'tldts'

import type { WebsiteResult } from '@/services/bindings'

import type { RequestPlan } from './routing-coverage'

export type JudgeWebsiteScope = (request: string) => Promise<string>

function suffixCandidate(found: WebsiteResult): string | null {
  const url = new URL(found.website)
  const entry = url.hostname.toLowerCase()
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.port ||
    url.username ||
    url.password ||
    !found.hosts.includes(entry)
  )
    return null
  // Only remove the www alias. Service hosts (e.g. mail.qq.com) remain separate.
  const candidate = entry.replace(/^www\./, '')
  const info = parse(candidate, { allowPrivateDomains: true })
  if (
    !info.domain ||
    (!info.isIcann && !info.isPrivate) ||
    [
      'qq.com',
      'google.com',
      'github.com',
      'microsoft.com',
      'apple.com',
    ].includes(candidate)
  )
    return null
  return candidate
}

export async function discoverWebsites(
  plan: RequestPlan,
  search: (term: string, research: boolean) => Promise<WebsiteResult>,
  signal: AbortSignal,
  judge: JudgeWebsiteScope,
  initial: WebsiteResult[] = [],
): Promise<RequestPlan> {
  const terms = [
    ...new Set(plan.jobs.flatMap((j) => (j.lookup ? [j.lookup] : []))),
  ]
  if (!terms.length) return plan
  if (terms.length > 3) throw Error('请每次查询最多三个网站。')
  const websites: WebsiteResult[] = []
  for (const term of terms) {
    signal.throwIfAborted()
    const found =
      initial.find((s) => s.name === term) ??
      (await search(
        term,
        plan.jobs.some((j) => j.lookup === term && j.research),
      ))
    signal.throwIfAborted()
    if (
      found.name !== term ||
      !found.hosts.length ||
      found.hosts.some((h) => !/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/i.test(h))
    )
      throw Error('没有查到可核对的官网主机：' + term)
    websites.push(found)
  }
  const pending = plan.jobs.flatMap((job, id) => {
    const site = websites.find((s) => s.name === job.lookup)
    return site
      ? [
          {
            id,
            term: site.name,
            quote: job.phrase,
            route: job.route,
            requestedSubdomains: !!job.includeSubdomains,
            process: job.browser,
            otherwise: job.otherwise,
            source: site.source,
            website: site.website,
            exactHosts: site.hosts,
            suffixCandidate: suffixCandidate(site),
            optionalHosts: site.optional,
          },
        ]
      : []
  })
  const raw = await judge(
    JSON.stringify({
      phase: 'choose_verified_scope',
      instruction: plan.instruction,
      requests: pending,
    }),
  )
  signal.throwIfAborted()
  let answer
  try {
    answer = JSON.parse(
      raw.trim().replace(/^\x60{3}(?:json)?\s*([\s\S]*?)\s*\x60{3}$/i, '$1'),
    )
  } catch {
    throw Error('模型未返回可读取的域名范围判断。')
  }
  if (typeof answer?.clarification === 'string' && answer.clarification.trim())
    throw Error(answer.clarification.slice(0, 600))
  if (
    !Array.isArray(answer?.decisions) ||
    answer.decisions.length !== pending.length
  )
    throw Error('模型没有逐项完成官网核对。')
  const jobs = [...plan.jobs],
    notes = new Set(plan.notes),
    seen = new Set<number>()
  for (const d of answer.decisions) {
    const fact = pending.find((f) => f.id === d?.id)
    if (
      !fact ||
      seen.has(fact.id) ||
      !['exact', 'subdomains'].includes(d.scope) ||
      Object.keys(d).some((k) => !['id', 'scope', 'reason'].includes(k)) ||
      typeof d.reason !== 'string' ||
      !d.reason.trim() ||
      d.reason.length > 600
    )
      throw Error('模型的范围判断无法对应已核实的来源。')
    seen.add(fact.id)
    const j = jobs[fact.id]
    let conditions = fact.exactHosts.map((h) => 'DOMAIN,' + h)
    if (d.scope === 'subdomains') {
      const suffix = fact.suffixCandidate
      if (!suffix)
        throw Error(
          '已找到官网，但没有可用的专属后缀；公共后缀或共享平台不能整体分流。',
        )
      conditions = [
        'DOMAIN-SUFFIX,' + suffix,
        ...fact.exactHosts
          .filter((h) => h !== suffix && !h.endsWith('.' + suffix))
          .map((h) => 'DOMAIN,' + h),
      ]
      notes.add(
        fact.term + '：' + suffix + ' 及其子域名。独立域名需要另外核实。',
      )
    } else
      notes.add(
        fact.term + '：只覆盖已查到的入口 ' + fact.exactHosts.join('、') + '。',
      )
    notes.add('模型依据：' + d.reason)
    jobs[fact.id] = { ...j, target: { ...j.target, conditions } }
  }
  return { ...plan, jobs, websites, notes: [...notes] }
}
