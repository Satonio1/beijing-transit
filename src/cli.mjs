#!/usr/bin/env node
import { errorResponse } from './schema.mjs';
import { nextTrain, lastTrain, shortcut, decide } from './metro-provider.mjs';
import { routeAmap } from './amap-provider.mjs';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command, _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (!next || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function usage() {
  return `Usage:
  node src/cli.mjs next-train --line 10 --station 国贸 --to 劲松 [--now 21:40]
  node src/cli.mjs last-train --line 10 --station 国贸 --to 劲松 [--now 21:40]
  node src/cli.mjs route --from 国贸 --to 奥林匹克森林公园 [--provider amap]
  node src/cli.mjs shortcut 回家
  node src/cli.mjs decide --line 10 --from 国贸 --to 劲松 --question 现在走还是等下一班
`;
}

function requireCacheHint(error) {
  return error?.message?.includes('Metro cache not found')
    ? 'Run: node projects/beijing-transit/scripts/refresh-metro-data.mjs'
    : null;
}

async function safeRun(fn) {
  try {
    printJson(await fn());
  } catch (error) {
    const hint = requireCacheHint(error);
    printJson(errorResponse({
      query: args,
      code: 'RUNTIME_ERROR',
      message: error.message,
      warnings: hint ? [hint] : [],
    }));
  }
}

const args = parseArgs(process.argv.slice(2));

switch (args.command) {
  case 'next-train':
    safeRun(() => nextTrain({ line: args.line, station: args.station, to: args.to, direction: args.direction, now: args.now }));
    break;
  case 'last-train':
    safeRun(() => lastTrain({ line: args.line, station: args.station, to: args.to, direction: args.direction, now: args.now }));
    break;
  case 'route':
    if (args.provider === 'local') safeRun(() => decide({ line: args.line, from: args.from, to: args.to, direction: args.direction, question: 'route', now: args.now }));
    else safeRun(() => routeAmap({ from: args.from, to: args.to, now: args.now }));
    break;
  case 'shortcut':
    safeRun(() => shortcut({ alias: args._.join(' ').trim(), now: args.now }));
    break;
  case 'decide':
    safeRun(() => decide({ line: args.line, station: args.station, from: args.from, to: args.to, direction: args.direction, question: args.question, now: args.now }));
    break;
  case 'help':
  case undefined:
    process.stdout.write(usage());
    break;
  default:
    printJson(errorResponse({
      query: args,
      code: 'UNKNOWN_COMMAND',
      message: `Unknown command: ${args.command}`,
      warnings: [usage()],
    }));
}
