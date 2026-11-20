import { expect, it } from 'vitest'

import { apiPlan, modelRequest } from './api-rule-plan'
import { resolvePlan } from './routing-coverage'
import { discoverWebsites } from './website-discovery'

const qq = {
  name: 'QQ邮箱',
  source: 'https://www.wikidata.org/wiki/Q10852228',
  website: 'https://mail.qq.com/',
  hosts: ['mail.qq.com', 'wx.mail.qq.com'],
  optional: ['res.wx.qq.com'],
}
const input = '让我的QQ邮箱网页端走直连'
const signal = new AbortController().signal
const exact = async () =>
  JSON.stringify({ decisions: [{ id: 0, scope: 'exact', reason: '网页入口' }] })
function response(
  text: string,
  target: string,
  more: Record<string, unknown> = {},
) {
  return JSON.stringify({
    rules: [{ target, webSearch: true, route: 'direct', quote: text, ...more }],
  })
}
it('grounds a named web request in live evidence without duplicating the lookup', async () => {
  expect(JSON.parse(modelRequest(input, {}, qq)).website.hosts).toEqual(
    qq.hosts,
  )
  for (const target of ['QQ邮箱', 'QQ邮箱网页端', 'mail.qq.com']) {
    const pending = apiPlan(
      response(input, target),
      input,
      { QQ: 'D:\\QQ' },
      null,
      [],
      qq,
    )
    await expect(resolvePlan(pending, '', null, signal)).rejects.toThrow(/核实/)
    const plan = await discoverWebsites(
      pending,
      async () => {
        throw Error('duplicate lookup')
      },
      signal,
      exact,
      [qq],
    )
    expect(await resolvePlan(plan, '', null, signal)).toEqual([
      'DOMAIN,mail.qq.com,DIRECT',
      'DOMAIN,wx.mail.qq.com,DIRECT',
    ])
  }
  expect(() =>
    apiPlan(response(input, 'qq.com'), input, {}, null, [], qq),
  ).toThrow()
  expect(() =>
    apiPlan(
      response(input, 'QQ邮箱', { route: 'unsupported' }),
      input,
      {},
      null,
      [],
      qq,
    ),
  ).toThrow()
})
it('uses model-requested search for another public product and keeps scope and fallback', async () => {
  const text = '只让 Edge 中的网易邮箱网页端走代理，其他应用访问它时直连'
  const p = apiPlan(
    response(text, '网易邮箱', {
      route: 'proxy',
      process: 'msedge.exe',
      otherwise: 'direct',
    }),
    text,
    {},
    null,
    ['Group'],
  )
  const queries: string[] = []
  const ready = await discoverWebsites(
    p,
    async (n) => {
      queries.push(n)
      return { ...qq, name: n, hosts: ['email.163.com'], optional: [] }
    },
    signal,
    exact,
  )
  expect(queries).toEqual(['网易邮箱'])
  expect(await resolvePlan(ready, 'Group', null, signal)).toEqual([
    'AND,((PROCESS-NAME,msedge.exe),(DOMAIN,email.163.com)),Group',
    'DOMAIN,email.163.com,DIRECT',
  ])
})
it('keeps third-party resources opt-in and fails closed on unresolved terms', async () => {
  const p = apiPlan(
    response(input, 'QQ邮箱', { resources: true }),
    input,
    {},
    null,
    [],
  )
  await expect(
    discoverWebsites(
      p,
      async () => {
        throw Error('no website')
      },
      signal,
      exact,
    ),
  ).rejects.toThrow('no website')
  const ready = await discoverWebsites(p, async () => qq, signal, exact)
  await expect(resolvePlan(ready, '', null, signal)).rejects.toThrow()
  expect(
    await resolvePlan(ready, '', { QQ邮箱: ['DOMAIN,res.wx.qq.com'] }, signal),
  ).toContain('DOMAIN,res.wx.qq.com,DIRECT')
  expect(() =>
    apiPlan(response(input, '不相关的服务'), input, {}, null, []),
  ).toThrow()
})
