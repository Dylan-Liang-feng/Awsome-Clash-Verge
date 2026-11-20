import { getConnections } from 'tauri-plugin-mihomo-api'

import type { RequestPlan } from '@/utils/routing-coverage'

import { officialRuleHosts } from './cmds'

export type EvidenceHost = {
  host: string
  condition: string
  included: boolean
  observed: string[]
}
export type Evidence = {
  service: string
  origin: string
  source: string
  hosts: EvidenceHost[]
  fallback: string | null
  snapshot: boolean
}
export async function readRuleEvidence(
  plan: RequestPlan,
  service: string,
): Promise<Evidence> {
  const discovered = plan.websites?.find((s) => s.name === service)
  const [data, snapshot] = await Promise.all([
    discovered
      ? Promise.resolve([
          discovered.website,
          [...discovered.hosts, ...discovered.optional],
          null,
        ] as const)
      : officialRuleHosts(service),
    getConnections().catch(() => null),
  ])
  const jobs = plan.jobs.filter((j) => j.service === service)
  const base = jobs[0].target.conditions.filter((c) =>
    jobs.every((j) => j.target.conditions.includes(c)),
  )
  const [source, hosts, fallback] = data
  return {
    source,
    service,
    origin: discovered ? '官网登记来源' : '实时官方来源',
    fallback,
    snapshot: snapshot !== null,
    hosts: hosts.map((host) => {
      const wildcard = host.startsWith('*.')
      const name = wildcard ? host.slice(2) : host
      const condition = wildcard ? 'DOMAIN-WILDCARD,' + host : 'DOMAIN,' + host
      const included = base.some(
        (c) =>
          c === condition ||
          (c.startsWith('DOMAIN-SUFFIX,') &&
            (name === c.slice(14) || name.endsWith('.' + c.slice(14)))),
      )
      const observed = new Set<string>()
      for (const row of snapshot?.connections ?? []) {
        const h = (
          row.metadata.host ||
          row.metadata.sniffHost ||
          ''
        ).toLowerCase()
        if (!(wildcard ? h.endsWith('.' + name) : h === name)) continue
        if (
          !jobs.some(
            (j) =>
              !j.browser || j.browser === row.metadata.process?.toLowerCase(),
          )
        )
          continue
        observed.add(
          h +
            ' · ' +
            (row.metadata.process || '未知进程') +
            ' · ' +
            [...row.chains].reverse().join(' / '),
        )
      }
      return { host, condition, included, observed: [...observed].slice(0, 3) }
    }),
  }
}
