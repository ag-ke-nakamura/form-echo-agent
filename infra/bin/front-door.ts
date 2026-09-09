#!/usr/bin/env node
import * as path from 'node:path';
import { App } from 'aws-cdk-lib';
import { FormEchoFrontDoorStack } from '../lib/front-door-stack';
import { readRuntimeArn } from '../lib/runtime-arn';

const app = new App();

// このファイルは dist/bin/front-door.js として実行されるので、リポジトリルートは3つ上。
// cwd 基準にしないのは、`cdk` をどこから呼んでも同じ成果物を指すようにするため。
const repoRoot = path.join(__dirname, '..', '..', '..');
const frontendOutDir = path.join(repoRoot, 'nextjs-app', 'out');
const bffEntry = path.join(repoRoot, 'hono-app', 'src', 'lambda.ts');
// workspace の lock file は1つでルートにある（ADR-0015）。ここが esbuild の projectRoot に
// なるので、`hono-app` のエントリと node_modules の両方がこの下に入る。
const bffDepsLockFilePath = path.join(repoRoot, 'pnpm-lock.yaml');

// Runtime の ARN はここで解決する。`agentcore deploy` の結果としてコミットされている
// 状態ファイルが唯一の出所で、context にもスタックのコードにも手写ししない（#139）。
const runtimeArn = readRuntimeArn(path.join(repoRoot, 'agent-app', 'agentcore', '.cli', 'deployed-state.json'));

// Runtime・Gateway と同じ ap-northeast-1 に固定する（データを国内に閉じる。設計方針書の
// ADR-011 — このリポジトリの `docs/adr/0011` とは別物）。account は `cdk deploy` 実行時の
// AWS 資格情報から CDK が解決する（CDK_DEFAULT_ACCOUNT）。
new FormEchoFrontDoorStack(app, 'FormEchoFrontDoor', {
  frontendOutDir,
  bffEntry,
  bffDepsLockFilePath,
  runtimeArn,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'ap-northeast-1' },
  description: 'FormEcho: デプロイ済み検証環境の front door（ADR-0014）',
});
