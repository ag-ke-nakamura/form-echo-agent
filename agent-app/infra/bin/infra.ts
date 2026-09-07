#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { FormEchoAgentInfraStack } from '../lib/formecho-agent-infra-stack';

const app = new App();

// ADR-011 によりこの検証環境は ap-northeast-1 に固定する。account は
// `cdk deploy` 実行時の AWS 資格情報から CDK が解決する（CDK_DEFAULT_ACCOUNT）。
new FormEchoAgentInfraStack(app, 'FormEchoAgentInfra', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'ap-northeast-1' },
  description: 'FormEcho: agentcore.json のスキーマに乗らないリソース（ADR-0010）',
});
