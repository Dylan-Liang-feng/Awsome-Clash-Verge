import { describe, expect, it } from 'vitest'

import { apiPlan } from './api-rule-plan'
import { compileIntents, findTargets } from './natural-rules'
import { resolvePlan } from './routing-coverage'

describe('routing requests', () => {
  it('resolves installed applications locally and preserves the default policy', async () => {
    const request = '让无畏契约和 WeGame 直连，Gemini 网页走代理'
    const apps = {
      无畏契约: 'D:\\Games\\无畏契约(12)',
      WeGame: 'D:\\Apps\\WeGame',
    }
    const rules = await resolvePlan(
      apiPlan(
        JSON.stringify({
          rules: ['无畏契约', 'WeGame', 'Gemini网页'].map((target) => ({
            target,
            route: target === 'Gemini网页' ? 'proxy' : 'direct',
            quote: request,
          })),
        }),
        request,
        apps,
        null,
        [],
      ),
      'Proxy',
      {},
      new AbortController().signal,
    )
    expect(rules).toContain(
      'PROCESS-PATH-REGEX,(?i)^D:\\\\Games\\\\无畏契约\\(12\\)\\\\,DIRECT',
    )
    expect(rules).toContain('DOMAIN,gemini.google.com,Proxy')
    expect(rules).toHaveLength(4)
  })
  it('distinguishes negation, literal domains and executable names', async () => {
    const request = 'Game.exe 不走代理，example.com 走代理'
    expect(
      await resolvePlan(
        apiPlan(
          JSON.stringify({
            rules: [
              { target: 'Game.exe', route: 'direct', quote: request },
              { target: 'example.com', route: 'proxy', quote: request },
            ],
          }),
          request,
          {},
          null,
          [],
        ),
        'A',
        {},
        new AbortController().signal,
      ),
    ).toEqual(['PROCESS-NAME,game.exe,DIRECT', 'DOMAIN,example.com,A'])
    expect(() =>
      apiPlan(
        '{"clarification":"请明确所需线路"}',
        '不要把 example.com 改成直连',
        {},
        null,
        [],
      ),
    ).toThrow()
  })
  it('keeps an exact host or web-only request scoped to that target', () => {
    expect(findTargets('gemini.google.com 直连', {})).toEqual([
      { label: 'gemini.google.com', conditions: ['DOMAIN,gemini.google.com'] },
    ])
    expect(
      findTargets('Claude网页走代理', {}).flatMap(
        (target) => target.conditions,
      ),
    ).not.toContain('PROCESS-NAME,Claude.exe')
  })
  it('rejects fabricated targets, conflicting instructions and unavailable groups', () => {
    const targets = findTargets('example.com', {})
    const proxy = { target: 'example.com', route: 'proxy' }
    expect(() =>
      compileIntents([proxy, { ...proxy, route: 'direct' }], targets, 'A'),
    ).toThrow()
    expect(() =>
      compileIntents([{ target: 'MATCH', route: 'proxy' }], targets, 'A'),
    ).toThrow()
    expect(() => compileIntents([proxy], targets, '')).toThrow()
  })
})
