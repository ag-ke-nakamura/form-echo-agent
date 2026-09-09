#!/usr/bin/env node
import * as path from 'node:path';
import { App } from 'aws-cdk-lib';
import { FormEchoFrontDoorStack } from '../lib/front-door-stack';

const app = new App();

// このファイルは dist/bin/front-door.js として実行されるので、リポジトリルートは3つ上。
// cwd 基準にしないのは、`cdk` をどこから呼んでも同じ成果物を指すようにするため。
const frontendOutDir = path.join(__dirname, '..', '..', '..', 'nextjs-app', 'out');

// Runtime・Gateway と同じ ap-northeast-1 に固定する（データを国内に閉じる。設計方針書の
// ADR-011 — このリポジトリの `docs/adr/0011` とは別物）。account は `cdk deploy` 実行時の
// AWS 資格情報から CDK が解決する（CDK_DEFAULT_ACCOUNT）。
new FormEchoFrontDoorStack(app, 'FormEchoFrontDoor', {
  frontendOutDir,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'ap-northeast-1' },
  description: 'FormEcho: デプロイ済み検証環境の front door（ADR-0014）',
});
