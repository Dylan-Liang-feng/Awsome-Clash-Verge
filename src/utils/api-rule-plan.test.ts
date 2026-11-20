import { describe, expect, it } from 'vitest'

import { apiPlan, modelRequest } from './api-rule-plan'
import { resolvePlan } from './routing-coverage'

const input =
  '我在微软浏览器里刷 example.com 时想借道节点，换别的软件就沿本机线路。'
const item = {
  target: 'example.com',
  route: 'proxy',
  process: 'msedge.exe',
  otherwise: 'direct',
  quote: input,
}
const make = (rules: unknown[], text = input) =>
  apiPlan(JSON.stringify({ rules }), text, {}, null, ['A'])
describe('remote routing plans', () => {
  it('converts a conversational instruction and its local exception in a single model plan', async () => {
    expect(
      await resolvePlan(make([item]), 'A', null, new AbortController().signal),
    ).toEqual([
      'AND,((PROCESS-NAME,msedge.exe),(DOMAIN,example.com)),A',
      'DOMAIN,example.com,DIRECT',
    ])
  })
  it('keeps API input free of installation paths and unrelated applications', () => {
    const wire = modelRequest('WeGame 直连', {
      WeGame: 'D:\\Games\\WeGame',
      Unrelated: 'D:\\private',
    })
    expect(wire).toContain('WeGame')
    expect(wire).not.toMatch(/private|Unrelated|Games/)
  })
  it('checks literal scope, unknown domains, quotes, model-chosen group and unsupported fields', () => {
    expect(() => make([{ ...item, subdomains: '全部' }])).toThrow()
    for (const change of [
      { target: 'made-up.example' },
      { process: 'other.exe' },
      { quote: 'fiction' },
      { raw: 'MATCH,DIRECT' },
      { group: 'missing' },
    ])
      expect(() => make([{ ...item, ...change }])).toThrow()
  })
  it('keeps the selected group or accepts an explicitly named available group', async () => {
    const text = '给 example.com 用 A 这组线路'
    const p = make(
      [{ target: 'example.com', route: 'proxy', quote: text, group: 'A' }],
      text,
    )
    expect(
      await resolvePlan(p, 'B', null, new AbortController().signal),
    ).toEqual(['DOMAIN,example.com,A'])
  })
  it('returns clarification and rejects malformed or conflicting replies without any rule', async () => {
    expect(() =>
      apiPlan('{"clarification":"请给出具体域名"}', input, {}, null, []),
    ).toThrow('具体域名')
    expect(() => apiPlan('plain text', input, {}, null, [])).toThrow(/JSON/)
    const text = '请为 example.com 选一条合适的线路'
    const p = make(
      ['direct', 'proxy'].map((route) => ({
        route,
        target: 'example.com',
        quote: text,
      })),
      text,
    )
    await expect(
      resolvePlan(p, 'A', null, new AbortController().signal),
    ).rejects.toThrow(/冲突/)
  })
  it('requires explicit review for related services and never broadens exclusive CLI requests', () => {
    const text = 'Gemini 和它的相关资源走代理'
    expect(
      make(
        [{ target: 'Gemini', route: 'proxy', resources: true, quote: text }],
        text,
      ).requiresLookup,
    ).toBe(true)
    const cli = '只有 Claude Code 可以走代理'
    expect(() =>
      apiPlan(
        JSON.stringify({
          rules: [
            {
              target: 'Claude Code',
              route: 'proxy',
              quote: cli,
              exclusive: true,
            },
          ],
        }),
        cli,
        {},
        ['node.exe', 'api.deepseek.com'],
        ['A'],
      ),
    ).toThrow(/Node/)
  })
})
