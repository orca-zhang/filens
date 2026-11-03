import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import * as NativeExecutor from '@deepseek-ai/dsh-tool-executor-native';
import Subprocess from '@deepseek-ai/dsh-subprocess-local';
import Bash from '@deepseek-ai/dsh-bash-local';
import * as Filens from '../src/tools.js';

export async function toolContext(options = {}, services = {}) {
  options = { ...(process.env.FILENS_TEST_COMMAND ? { command: JSON.parse(process.env.FILENS_TEST_COMMAND) } : {}), ...options };
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(Tools);
  await ctx.plugin(NativeExecutor);
  if (!services.shell) {
    await ctx.plugin(Subprocess);
    await ctx.plugin(Bash);
  }
  for (const [key, value] of Object.entries({
    workingDirectory: { ensure: async () => process.cwd() }, shellEnv: { collect: () => ({}) }, ...services,
  })) await ctx.provide(key, value);
  const plugin = ctx.plugin(Filens, options);
  await plugin;
  return { ctx, plugin, call: (name, args = {}, extra = {}) => callTool(ctx, name, args, extra) };
}

export async function callTool(ctx, name, args = {}, extra = {}) {
  const batch = await ctx.tools.execute({
    calls: [{ type: 'tool-call', id: crypto.randomUUID(), name, arguments: JSON.stringify(args) }],
    signal: new AbortController().signal, ...extra,
  });
  return batch.results[0].result;
}
