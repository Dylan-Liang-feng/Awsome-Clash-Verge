import { describe, expect, it } from 'vitest'

import { apiPlan } from './api-rule-plan'
import { resolvePlan } from './routing-coverage'

const cli: [string, string] = ['node.exe', 'api.deepseek.com']
function intent(
  text: string,
  rules: object[],
  endpoint: [string, string] | null = cli,
) {
  return apiPlan(
    JSON.stringify({
      rules: rules.map((r) => ({ quote: text, route: 'proxy', ...r })),
    }),
    text,
    {},
    endpoint,
    ['Group'],
  )
}
const run = (text: string, ...rules: object[]) =>
  resolvePlan(intent(text, rules), 'Group', null, new AbortController().signal)
describe('requested scope survives rule generation', () => {
  it('distinguishes exact, suffix and mixed host requirements', async () => {
    expect(
      await run(
        'example.com 及其所有子域名都直连，gitlab.com 走代理',
        { target: 'example.com', route: 'direct', subdomains: true },
        { target: 'gitlab.com' },
      ),
    ).toEqual(['DOMAIN-SUFFIX,example.com,DIRECT', 'DOMAIN,gitlab.com,Group'])
  })
  it('does not confuse the npm CLI with desktop or all Node traffic', async () => {
    expect(await run('Claude Code 走代理', { target: 'Claude Code' })).toEqual([
      'AND,((PROCESS-NAME,node.exe),(DOMAIN,api.deepseek.com)),Group',
    ])
    expect(() =>
      intent('只让 Claude Code 走代理', [
        { target: 'Claude Code', exclusive: true },
      ]),
    ).toThrow(/Node/)
    expect(() =>
      intent('Claude Code 走代理', [{ target: 'Claude Code' }], null),
    ).toThrow()
  })
  it('limits browser rules to the browser and explicitly requested fallback', async () => {
    expect(
      await run('只让 Edge 中的 example.com 走代理，其他应用访问它时直连', {
        target: 'example.com',
        process: 'msedge.exe',
        otherwise: 'direct',
      }),
    ).toEqual([
      'AND,((PROCESS-NAME,msedge.exe),(DOMAIN,example.com)),Group',
      'DOMAIN,example.com,DIRECT',
    ])
    expect(
      await run('仅 Chrome 访问 example.com 时直连', {
        target: 'example.com',
        process: 'chrome.exe',
        route: 'direct',
      }),
    ).toEqual(['AND,((PROCESS-NAME,chrome.exe),(DOMAIN,example.com)),DIRECT'])
  })
  it('combines a named executable and host without routing the whole executable', async () => {
    expect(
      await run('node.exe 访问 api.deepseek.com 走代理', {
        target: 'api.deepseek.com',
        process: 'node.exe',
      }),
    ).toEqual(['AND,((PROCESS-NAME,node.exe),(DOMAIN,api.deepseek.com)),Group'])
  })
  it('keeps an exclusive desktop app scoped to its process', async () => {
    expect(
      await run('Claude 网页版走代理', { target: 'Claude网页' }),
    ).not.toContain('PROCESS-NAME,Claude.exe,Group')
    expect(
      await run('只让 Claude 客户端走代理', {
        target: 'Claude',
        exclusive: true,
      }),
    ).toEqual(['PROCESS-NAME,Claude.exe,Group'])
    expect(
      await run(
        'example.com 直连，只让 Edge 中的 example.com 走代理',
        { target: 'example.com', route: 'direct' },
        { target: 'example.com', process: 'msedge.exe' },
      ),
    ).toEqual([
      'AND,((PROCESS-NAME,msedge.exe),(DOMAIN,example.com)),Group',
      'DOMAIN,example.com,DIRECT',
    ])
  })
  it('never silently drops an unrecognised target or restriction', () => {
    expect(() =>
      intent('Gemini 和未知服务走代理', [{ target: '未知服务' }]),
    ).toThrow()
    expect(() =>
      intent('仅游戏更新时让 Game.exe 直连', [
        { target: 'Game.exe', schedule: 'updates' },
      ]),
    ).toThrow()
    expect(() =>
      intent('Gemini 走日本节点', [{ target: 'Gemini', group: '日本' }]),
    ).toThrow()
    expect(() =>
      intent('example.com/a 走代理', [{ target: 'example.com/a' }]),
    ).toThrow()
    expect(() =>
      intent('Gemini 走代理', [{ target: 'Gemini', otherwise: 'direct' }]),
    ).toThrow()
    expect(() =>
      intent('其他都直连', [{ target: 'MATCH', route: 'direct' }]),
    ).toThrow()
  })
  it('requires evidence for requested dependencies, keeps the browser scope on new hosts', async () => {
    const plan = intent(
      '只让 Edge 中的 Gemini 和它所有登录、图片资源都走代理',
      [{ target: 'Gemini', process: 'msedge.exe', resources: true }],
    )
    expect(plan.service).toBe('Gemini')
    expect(plan.requiresLookup).toBe(true)
    await expect(
      resolvePlan(plan, 'Group', null, new AbortController().signal),
    ).rejects.toThrow(/官方来源/)
    const rules = await resolvePlan(
      plan,
      'Group',
      { Gemini: ['DOMAIN,accounts.google.com'] },
      new AbortController().signal,
    )
    expect(rules).toContain(
      'AND,((PROCESS-NAME,msedge.exe),(DOMAIN,accounts.google.com)),Group',
    )
    expect(rules.every((r) => r.startsWith('AND,'))).toBe(true)
  })
})
