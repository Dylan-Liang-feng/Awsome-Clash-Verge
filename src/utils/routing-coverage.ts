import { parse } from 'tldts'

import {
  compileIntents,
  findTargets,
  type AppCatalog,
  type RuleIntent,
  type RuleTarget,
} from './natural-rules'

export type Service = string
type Job = {
  target: RuleTarget
  phrase: string
  route: RuleIntent['route']
  group?: string
  applicationConditions?: string[]
  browser?: string
  otherwise?: RuleIntent['route']
  service?: Service
  lookup?: string
  research?: boolean
  bypassTun?: boolean
  includeSubdomains?: boolean
  reviewResources?: boolean
}
type Cli = [string, string] | null
export type RequestPlan = {
  instruction: string
  jobs: Job[]
  websites?: import('@/services/bindings').WebsiteResult[]
  requiresLookup: boolean
  service?: Service
  notes: string[]
}
const hostPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i
export type ResourceSelection = Record<string, string[]>

export function groundedTarget(
  label: string,
  apps: AppCatalog,
  cli: Cli,
  flags: {
    subdomains?: boolean
    exclusive?: boolean
    process?: string
    resources?: boolean
  },
  notes: string[],
): RuleTarget {
  if (label.toLowerCase() === 'claude code') {
    if (!cli || !hostPattern.test(cli[1]))
      throw Error('未确认 Claude Code 的本机接口。')
    if (flags.exclusive && cli[0] === 'node.exe')
      throw Error('共享 Node 运行时无法独占 Claude Code。')
    if (flags.process || flags.resources || flags.subdomains)
      throw Error('CLI 模型接口仅能按实际进程与域名匹配。')
    if (
      cli[0] !== 'node.exe' &&
      (!/^[A-Z]:\\.*\\claude\.exe$/i.test(cli[0]) || /[,\r\n()]/.test(cli[0]))
    )
      throw Error('无法核实 CLI 程序路径。')
    const type = cli[0] === 'node.exe' ? 'PROCESS-NAME' : 'PROCESS-PATH'
    notes.push(
      '仅覆盖已确认的 CLI 模型接口 ' +
        cli[1] +
        '。' +
        (cli[0] === 'node.exe' ? '其他 Node 程序访问同一域名也会匹配。' : ''),
    )
    return {
      label,
      conditions: [
        'AND,((' + type + ',' + cli[0] + '),(DOMAIN,' + cli[1] + '))',
      ],
    }
  }
  const target = findTargets(label, apps).find(
    (t) => t.label.toLowerCase() === label.toLowerCase(),
  )
  if (!target) throw Error('没有核实该目标：' + label)
  if (
    flags.subdomains &&
    hostPattern.test(label) &&
    !label.toLowerCase().endsWith('.exe')
  ) {
    const zone = parse(label, { allowPrivateDomains: true })
    if ((zone.isIcann || zone.isPrivate) && !zone.domain)
      throw Error('目标是公共后缀，无法作为机构的专属域名。')
    return { label, conditions: ['DOMAIN-SUFFIX,' + label.toLowerCase()] }
  }
  if (
    flags.subdomains &&
    !target.conditions.some((c) => c.startsWith('DOMAIN'))
  )
    throw Error('目标只有进程依据；域名后缀需要网站证据。')
  const processOnly =
    flags.exclusive &&
    !flags.process &&
    target.conditions.some((c) => c.startsWith('PROCESS-'))
  const conditions = flags.process
    ? target.conditions.filter((c) => c.startsWith('DOMAIN'))
    : processOnly
      ? target.conditions.filter((c) => c.startsWith('PROCESS-'))
      : target.conditions
  if (!conditions.length) throw Error('此目标与请求的进程或域名限制无法组合。')
  return { label, conditions }
}

export async function resolvePlan(
  plan: RequestPlan,
  group: string,
  extra: ResourceSelection | null,
  signal: AbortSignal,
) {
  if (
    plan.jobs.some(
      (j) =>
        j.reviewResources &&
        (!extra || !j.service || !Object.hasOwn(extra, j.service)),
    )
  )
    throw Error('请先核对官方来源并选择要补充的域名。')
  for (const condition of Object.values(extra ?? {}).flat()) {
    const [kind, name, ...rest] = condition.split(',')
    if (
      rest.length ||
      !(
        (kind === 'DOMAIN' && hostPattern.test(name)) ||
        (kind === 'DOMAIN-WILDCARD' &&
          name?.startsWith('*.') &&
          hostPattern.test(name.slice(2)))
      )
    )
      throw Error('资源域名格式无效。')
  }
  const lines: string[] = []
  for (const job of plan.jobs) {
    signal.throwIfAborted()
    if (job.lookup && !job.target.conditions.length)
      throw Error('尚未核实网页域名，本次没有添加规则。')
    const route = job.route
    const destination = job.group ?? group
    const target = {
      ...job.target,
      conditions: [
        ...new Set([
          ...job.target.conditions,
          ...(job.service ? (extra?.[job.service] ?? []) : []),
        ]),
      ],
    }
    if (job.bypassTun) {
      if (
        route !== 'direct' ||
        job.browser ||
        job.applicationConditions ||
        job.otherwise
      )
        throw Error('浏览器物理网卡绕行只支持网站直连。')
      for (const c of target.conditions) {
        if (!/^DOMAIN(?:-SUFFIX)?,[a-z0-9.-]+$/i.test(c))
          throw Error('当前绕行仅支持精确主机或域名后缀。')
        lines.push(
          'AND,((IN-TYPE,HTTP/HTTPS),(SRC-IP-CIDR,127.0.0.1/32),(' +
            c +
            ')),DIRECT',
        )
      }
      continue
    }
    if (job.browser) {
      const scoped = {
        ...target,
        conditions: (
          job.applicationConditions ?? ['PROCESS-NAME,' + job.browser]
        ).flatMap((proc) =>
          target.conditions.map((c) => 'AND,((' + proc + '),(' + c + '))'),
        ),
      }
      lines.push(
        ...compileIntents(
          [{ target: target.label, route }],
          [scoped],
          destination,
        ),
      )
      if (job.otherwise)
        lines.push(
          ...compileIntents(
            [{ target: target.label, route: job.otherwise }],
            [target],
            destination,
          ),
        )
    } else
      lines.push(
        ...compileIntents(
          [{ target: target.label, route }],
          [target],
          destination,
        ),
      )
  }
  const policies = new Map<string, string>()
  for (const line of lines) {
    const i = line.lastIndexOf(',')
    const matcher = line.slice(0, i),
      policy = line.slice(i + 1)
    if (policies.has(matcher) && policies.get(matcher) !== policy)
      throw Error('模型给同一匹配条件分配了相互冲突的策略。')
    policies.set(matcher, policy)
  }
  // A specific process/host rule must precede a plain rule for the same host.
  return [...new Set(lines)].sort(
    (a, b) => Number(b.startsWith('AND,')) - Number(a.startsWith('AND,')),
  )
}
