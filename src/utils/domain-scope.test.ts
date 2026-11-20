import { expect, it } from 'vitest'

import { apiPlan } from './api-rule-plan'
import { resolvePlan } from './routing-coverage'
import { discoverWebsites } from './website-discovery'

const signal = new AbortController().signal
const judge = async (body: string) => {
  const data = JSON.parse(body)
  expect(data.phase).toBe('choose_verified_scope')
  expect(data.instruction).toBeTruthy()
  return JSON.stringify({
    decisions: data.requests.map(
      (r: { id: number; requestedSubdomains: boolean; source: string }) => ({
        id: r.id,
        scope: r.requestedSubdomains ? 'subdomains' : 'exact',
        reason: '核对过官网范围',
      }),
    ),
  })
}
const sampleUniversity = '将示例大学相关网页都使用直连方式进入'
const found = (name: string, host: string) => ({
  name,
  website: 'https://' + host + '/',
  source: 'https://www.wikidata.org/wiki/item',
  hosts: [host],
  optional: [],
})
async function generate(
  name: string,
  host: string,
  text: string,
  subdomains: boolean,
  scope = {},
) {
  const p = apiPlan(
    JSON.stringify({
      rules: [
        {
          target: name,
          quote: text,
          route: 'direct',
          webSearch: true,
          subdomains,
          ...scope,
        },
      ],
    }),
    text,
    {},
    null,
    [],
  )
  const ready = await discoverWebsites(
    p,
    async () => found(name, host),
    signal,
    judge,
  )
  return resolvePlan(ready, 'Test', null, signal)
}
it('grounds a name before requiring a suffix, independently of the institution or wording', async () => {
  expect(await generate('示例大学', 'www.sample.edu.cn', sampleUniversity, true)).toEqual([
    'DOMAIN-SUFFIX,sample.edu.cn,DIRECT',
  ])
  expect(
    await generate(
      '北京大学',
      'www.pku.edu.cn',
      '访问北京大学下属各学院时用本地网络',
      true,
    ),
  ).toEqual(['DOMAIN-SUFFIX,pku.edu.cn,DIRECT'])
  expect(
    await generate(
      '示例大学',
      'www.sample.edu.cn',
      '只打开示例大学官网就直接连接',
      false,
    ),
  ).toEqual(['DOMAIN,www.sample.edu.cn,DIRECT'])
})
it('preserves service boundaries, browser constraints and private suffixes', async () => {
  expect(
    await generate(
      'QQ邮箱',
      'mail.qq.com',
      '只让 Edge 中的QQ邮箱相关网页直连',
      true,
      { process: 'msedge.exe' },
    ),
  ).toEqual([
    'AND,((PROCESS-NAME,msedge.exe),(DOMAIN-SUFFIX,mail.qq.com)),DIRECT',
  ])
  expect(
    await generate(
      '演示网站',
      'team.github.io',
      '演示网站所有子域名直连',
      true,
    ),
  ).toEqual(['DOMAIN-SUFFIX,team.github.io,DIRECT'])
  for (const host of [
    'www.edu.cn',
    'www.github.io',
    'www.co.uk',
    'www.google.com',
  ])
    await expect(
      generate('演示网站', host, '演示网站所有子域名直连', true),
    ).rejects.toThrow()
})
it('uses the final model decision after lookup, and never accepts a model-supplied replacement host', async () => {
  const p = apiPlan(
    JSON.stringify({
      rules: [
        { target: '示例大学', route: 'direct', quote: sampleUniversity, webSearch: true },
      ],
    }),
    sampleUniversity,
    {},
    null,
    [],
  )
  const decision = (d: object) => async (body: string) => {
    const f = JSON.parse(body)
    expect(f.requests[0].suffixCandidate).toBe('sample.edu.cn')
    return JSON.stringify({
      decisions: [{ id: 0, reason: '学校官网及下属网站', ...d }],
    })
  }
  const search = async () => found('示例大学', 'www.sample.edu.cn')
  const ready = await discoverWebsites(
    p,
    search,
    signal,
    decision({ scope: 'subdomains' }),
  )
  expect(await resolvePlan(ready, '', null, signal)).toEqual([
    'DOMAIN-SUFFIX,sample.edu.cn,DIRECT',
  ])
  await expect(
    discoverWebsites(
      p,
      search,
      signal,
      decision({ scope: 'subdomains', host: 'edu.cn' }),
    ),
  ).rejects.toThrow()
})
it('keeps additional resources with their own websites in a combined request', async () => {
  const text = '示例大学相关网页直连，北京大学相关网页走代理'
  const rules = [
    ['示例大学', 'direct'],
    ['北京大学', 'proxy'],
  ].map(([target, route]) => ({
    target,
    route,
    webSearch: true,
    quote: text,
    subdomains: true,
    resources: true,
  }))
  const p = apiPlan(JSON.stringify({ rules }), text, {}, null, ['P'])
  const ready = await discoverWebsites(
    p,
    async (n) =>
      found(n, n === '示例大学' ? 'www.sample.edu.cn' : 'www.pku.edu.cn'),
    signal,
    judge,
  )
  await expect(resolvePlan(ready, 'P', null, signal)).rejects.toThrow()
  expect(
    await resolvePlan(
      ready,
      'P',
      { 示例大学: ['DOMAIN,extra.example.com'], 北京大学: [] },
      signal,
    ),
  ).toEqual([
    'DOMAIN-SUFFIX,sample.edu.cn,DIRECT',
    'DOMAIN,extra.example.com,DIRECT',
    'DOMAIN-SUFFIX,pku.edu.cn,P',
  ])
})
