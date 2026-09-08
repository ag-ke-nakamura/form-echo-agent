import { getActivatedSkills } from '../invocation/domain-agent.js';
import { invokeTask } from '../invocation/invoke-task.js';

/**
 * 自動モード（#42）の Skill 選択的中率を、日本語の入力セットで実測する（#44、
 * ADR-032 論点4 / F-09）。**合否判定は持たない** — #23 の Testing Decisions に
 * 従い、観測した数字だけを記録する。
 *
 * 会議ロジの3タスクは同じドメインエージェント（1つの `AgentSkills` プラグイン）を
 * 共有するため、`taskId` を教えなくても Skill 名だけで的中率を測れる —
 * `getActivatedSkills`（`domain-agent.ts`）は活性化された Skill 名を返す。
 *
 * 実行:
 *   FORMECHO_MODEL=sonnet FORMECHO_SKILL_SELECTION_MODE=auto npx tsx tests/measure-skill-selection.ts
 */

process.env.FORMECHO_SKILL_SELECTION_MODE = 'auto';

interface Case {
  id: string;
  taskId:
    | 'meeting.parse-candidates'
    | 'meeting.parse-availability'
    | 'meeting.recommend-schedule';
  expectedSkill:
    | 'parse-candidates'
    | 'parse-availability'
    | 'recommend-schedule';
  prompt: string;
  input: unknown;
}

const CASES: Case[] = [
  {
    id: 'candidates-1',
    taskId: 'meeting.parse-candidates',
    expectedSkill: 'parse-candidates',
    prompt:
      '来月の火曜と木曜の午後で、1時間の会議候補をいくつか出してください。',
    input: {
      duration_minutes: 60,
      calendar_start: '2027-04-01',
      calendar_end: '2027-04-30',
    },
  },
  {
    id: 'candidates-2',
    taskId: 'meeting.parse-candidates',
    expectedSkill: 'parse-candidates',
    prompt: '再来週の午前中で30分の1on1の候補日を3つ提案してください。',
    input: {
      duration_minutes: 30,
      calendar_start: '2027-04-01',
      calendar_end: '2027-04-14',
    },
  },
  {
    id: 'availability-1',
    taskId: 'meeting.parse-availability',
    expectedSkill: 'parse-availability',
    prompt:
      '参加者A・B・Cからの回答です。候補1は参加者Aが出席（現地）、参加者Bが欠席、参加者Cが未定でした。候補2は参加者A・Bが出席（オンライン）、参加者Cは返事なしです。',
    input: {
      meeting_format: 'hybrid',
      duration_minutes: 60,
      candidates: [
        { id: 'candidate-1', date: '2027-04-06', start_time: '10:00' },
        { id: 'candidate-2', date: '2027-04-08', start_time: '14:00' },
      ],
    },
  },
  {
    id: 'availability-2',
    taskId: 'meeting.parse-availability',
    expectedSkill: 'parse-availability',
    prompt: '候補日1は参加者Dが参加可能（現地）、参加者Eは欠席と回答しました。',
    input: {
      meeting_format: 'onsite',
      duration_minutes: 30,
      candidates: [
        { id: 'candidate-1', date: '2027-04-06', start_time: '09:00' },
      ],
    },
  },
  {
    id: 'recommend-1',
    taskId: 'meeting.recommend-schedule',
    expectedSkill: 'recommend-schedule',
    prompt:
      '参加可否表をもとに、どの候補日がよいか評価してください。参加者5人中より多く出席できる候補を優先してください。',
    input: {
      meeting_format: 'hybrid',
      duration_minutes: 60,
      participants: ['参加者A', '参加者B', '参加者C', '参加者D', '参加者E'],
      candidates: [
        {
          id: 'candidate-1',
          date: '2027-04-06',
          start_time: '10:00',
          answers: [
            { participant: '参加者A', availability: 'attend_onsite' },
            { participant: '参加者B', availability: 'attend_onsite' },
            { participant: '参加者C', availability: 'attend_remote' },
            { participant: '参加者D', availability: 'attend_onsite' },
          ],
        },
        {
          id: 'candidate-2',
          date: '2027-04-08',
          start_time: '14:00',
          answers: [
            { participant: '参加者A', availability: 'absent' },
            { participant: '参加者B', availability: 'attend_onsite' },
          ],
        },
      ],
    },
  },
  {
    id: 'recommend-2',
    taskId: 'meeting.recommend-schedule',
    expectedSkill: 'recommend-schedule',
    prompt: '欠席者が最も少ない候補日に高い評点を付けてください。',
    input: {
      meeting_format: 'online',
      duration_minutes: 30,
      participants: ['参加者A', '参加者B', '参加者C'],
      candidates: [
        {
          id: 'candidate-1',
          date: '2027-04-06',
          start_time: '10:00',
          answers: [
            { participant: '参加者A', availability: 'attend_remote' },
            { participant: '参加者B', availability: 'absent' },
          ],
        },
      ],
    },
  },
];

interface Observation {
  id: string;
  taskId: string;
  expectedSkill: string;
  activatedSkills: readonly string[];
  hit: boolean;
}

async function run(): Promise<void> {
  const observations: Observation[] = [];
  for (const testCase of CASES) {
    const sessionId = `measure-skill-${testCase.id}`;
    await invokeTask(
      {
        taskId: testCase.taskId,
        prompt: testCase.prompt,
        input: testCase.input,
        sessionId,
      },
      {
        warn: (context, message) =>
          console.error('[warn]', message, JSON.stringify(context)),
        error: (context, message) =>
          console.error('[error]', message, JSON.stringify(context)),
      },
    );
    const activatedSkills = getActivatedSkills(sessionId, testCase.taskId);
    observations.push({
      id: testCase.id,
      taskId: testCase.taskId,
      expectedSkill: testCase.expectedSkill,
      activatedSkills,
      hit: activatedSkills.includes(testCase.expectedSkill),
    });
  }

  const hitRate =
    observations.filter((o) => o.hit).length / observations.length;

  console.log(JSON.stringify({ observations, hitRate }, null, 2));
}

await run();
