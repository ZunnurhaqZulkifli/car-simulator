// just ?bulbs: every lamp held on with the ignition off (layout check, e.g. W=390 for a phone)
export default async ({ run, wait, shot }) => { await run('window.__bulbs = true'); await wait(400); await shot('bulbs-w' + (process.env.W || 1440), process.env.SEL || '.cluster'); };
