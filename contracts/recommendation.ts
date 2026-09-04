/**
 * 候補日提案の**導出と集計**（ADR-0007）。AI が返した評点から AI評価ラベルを導き、
 * 参加可否表から人数を数える。
 *
 * WHY 契約側に置くか: 同じ判断を引くのがフロントエンド（ラベルの表示と初期選択）と
 * BFF・Runtime の検査（評点の値域）だからではない — 引くのは今のところ画面だけである。
 * 置き場所を決めているのは**評点の意味**のほうで、閾値は出力契約の `score` が 0.0〜1.0 の
 * どこに落ちるかという契約そのものである。閾値だけを画面に置くと、契約が値域を変えた
 * ときに画面だけが古い境界のまま残る。
 *
 * WHY zod を import しないか: `meeting.ts` と同じ理由。フロントエンドはラベルの chip を
 * 描き、人数を出すためにこれらを**値として**実行時に必要とする。スキーマと同じモジュールに
 * 置くと SSG のバンドルに zod が丸ごと乗る。
 *
 * **このファイルは `contracts/` の他のモジュールを値として import できない。** 引けるのは
 * `import type` だけである。相対 import の `.js` は Runtime の NodeNext が要求する形だが、
 * フロントエンドのバンドラ（Turbopack / webpack）はそれを `.ts` に読み替えない —
 * `moduleResolution: bundler` の読み替えは tsc の中だけの話で、`next.config.ts` にも
 * 効かせる設定が無い（`resolveAlias` も `resolveExtensions` も届かない）。型だけの import は
 * emit 時に消えるので、この制約は**画面が値として引くモジュールにだけ**掛かる。
 *
 * **AI に数えさせない。** 参加可能人数・現地／リモートの内訳・欠席者・未回答者数は
 * すべてここが参加可否表から数える。設計書 7.1節は `metrics` として AI に返させているが、
 * 数えた結果を返させると、表を見れば分かることをモデルが間違える余地が残る。
 */

import type { RecommendScheduleInput } from './inputs.js';
import type { Availability } from './meeting.js';
import type { RecommendScheduleOutput } from './outputs.js';

/** 参加可否表の候補日程ひとつ（識別子・日付・開始時刻と、その候補日程への回答）。 */
export type TableCandidate = RecommendScheduleInput['candidates'][number];

/** AI が返した評点と根拠ひとつ。 */
export type CandidateEvaluation =
  RecommendScheduleOutput['evaluations'][number];

/**
 * AI評価ラベルの値域（`CONTEXT.md`「AI評価ラベル」）。
 *
 * **AI はこれを返さない。** 評点と回答率から機械的に導かれる区分である（ADR-0007）。
 *
 * `meeting.ts` の列挙と同じく**配列を正典にして型を導く**。ラベルを足したときに、
 * 表示名の表（`AI_EVALUATION_LABELS`）と chip の配色の表が型検査で追加を要求する。
 * 列挙を2箇所に書くと、画面に出るのに表示名の無いラベルが作れてしまう。
 */
export const AI_EVALUATION_LABEL_ORDER = [
  'recommended',
  'backup',
  'consider',
  'rejected',
  'unanswered',
] as const;

export type AiEvaluationLabel = (typeof AI_EVALUATION_LABEL_ORDER)[number];

/**
 * 評点からラベルを決める下限。設計書 7.2節の暫定基準をそのまま初期値にする。
 *
 * 各値は**その値以上**を意味する（`recommended` は 0.80〜1.00）。どれにも届かなければ
 * `rejected` になるので、`rejected` の下限は持たない — 持つと、0.30 未満の評点が
 * どのラベルにもならない穴ができる。
 *
 * WHY `unanswered` がこの表に無いか: 設計書は 7.2節で参加可能率29%以下、10.3節で
 * 回答率30%未満と、同じラベルに2つの基準を与えていて矛盾している。全員が「欠席」と
 * 答えた候補日程（回答率100%・参加可能率0%）がどちらになるか決まらない。語義どおり
 * 回答率で判定し、この表からは外した（ADR-0007）。
 */
export const SCORE_THRESHOLDS = {
  recommended: 0.8,
  backup: 0.7,
  consider: 0.5,
} as const;

/**
 * この回答率を下回る候補日程は「参加入力未済」になる（設計書 10.3節）。
 *
 * 評点より先に効く。回答が2割しか集まっていない候補日程に AI が高い評点を付けても、
 * それは「集まった2割が出られる」以上のことを言っていない。
 */
export const UNANSWERED_RESPONSE_RATE = 0.3;

/**
 * 参加可否表全体でこの回答率を下回ると AI 提案を出さない（設計書 10.3節）。
 *
 * WHY 画面ではなくここか: 「回答が揃っているか」は参加可否表についての判断であって、
 * ボタンの活殺という画面の都合ではない。閾値を画面に置くと、ラベルの閾値
 * （`UNANSWERED_RESPONSE_RATE`）と揃っているのか別物なのかが読めなくなる。
 */
export const RECOMMENDATION_RESPONSE_RATE = 0.5;

/** 候補日程ひとつの集計値。**参加者は識別子で持つ**（実名は画面が解決する。ADR-0008）。 */
export type CandidateMetrics = {
  candidateId: string;
  /** 参加できると答えた人数（現地＋リモート）。 */
  attendCount: number;
  attendOnsiteCount: number;
  attendRemoteCount: number;
  /** 欠席と答えた参加者の識別子。人数ではなく名指しで持つ（設計書 4.5.2節）。 */
  absentParticipants: string[];
  undecidedCount: number;
  /** 回答の無い参加者の人数。**欠席ではない**（`CONTEXT.md`「未定」）。 */
  unansweredCount: number;
  answeredCount: number;
  /** 名簿のうち何割が答えたか。0〜1。 */
  responseRate: number;
};

/**
 * 候補日程ひとつを数える。
 *
 * **名簿を主にして数える。** 回答の側から数えると、名簿に無い参加者の回答が混ざった
 * ときに「参加可能5名／名簿4名」のような表が出る。名簿を回して回答を引けば、
 * 回答済みと未回答の和が必ず名簿の人数になる。
 *
 * WHY `isAttending`（`meeting.ts`）を呼ばないか: このファイルは値を import できない
 * （冒頭を参照）。代わりに参加可否4状態を1つの `switch` で網羅し、参加可能人数を
 * **内訳の和**として出す — 現地とリモートの内訳はどのみち数えるので、「出席は2通りある」
 * という事実がこの `switch` に一度だけ現れる形になる。状態が増えれば `switch` の
 * 網羅性検査が漏れを指す。
 */
export function summarizeCandidate(
  participants: readonly string[],
  candidate: TableCandidate,
): CandidateMetrics {
  const answerOf = new Map<string, Availability>(
    candidate.answers.map((answer) => [
      answer.participant,
      answer.availability,
    ]),
  );

  const metrics: CandidateMetrics = {
    candidateId: candidate.id,
    attendCount: 0,
    attendOnsiteCount: 0,
    attendRemoteCount: 0,
    absentParticipants: [],
    undecidedCount: 0,
    unansweredCount: 0,
    answeredCount: 0,
    responseRate: 0,
  };

  for (const participant of participants) {
    const availability = answerOf.get(participant);
    if (availability === undefined) {
      metrics.unansweredCount += 1;
      continue;
    }
    metrics.answeredCount += 1;
    switch (availability) {
      case 'attend_onsite':
        metrics.attendOnsiteCount += 1;
        break;
      case 'attend_remote':
        metrics.attendRemoteCount += 1;
        break;
      case 'absent':
        metrics.absentParticipants.push(participant);
        break;
      case 'undecided':
        metrics.undecidedCount += 1;
        break;
    }
  }

  metrics.attendCount = metrics.attendOnsiteCount + metrics.attendRemoteCount;
  metrics.responseRate =
    participants.length === 0 ? 0 : metrics.answeredCount / participants.length;
  return metrics;
}

/** 参加可否表を候補日程ごとに数える。並びは入力の候補日程のまま。 */
export function summarizeTable(
  input: RecommendScheduleInput,
): CandidateMetrics[] {
  return input.candidates.map((candidate) =>
    summarizeCandidate(input.participants, candidate),
  );
}

/** 参加可否表全体の回答率（埋まっているセル ÷ 参加者 × 候補日程）。 */
export function tableResponseRate(input: RecommendScheduleInput): number {
  const cells = input.participants.length * input.candidates.length;
  if (cells === 0) return 0;
  const answered = summarizeTable(input).reduce(
    (total, metrics) => total + metrics.answeredCount,
    0,
  );
  return answered / cells;
}

/**
 * AI に提案させてよいだけの回答が集まっているか（設計書 10.3節、ストーリー71）。
 *
 * 下回るときに画面が出すのは失敗ではなく通知である。少ない回答から出た推薦を
 * 職員が鵜呑みにしないための線であって、AI が壊れているわけではない。
 */
export function shouldRequestRecommendation(
  input: RecommendScheduleInput,
): boolean {
  return tableResponseRate(input) >= RECOMMENDATION_RESPONSE_RATE;
}

/**
 * 候補日程ひとつの AI評価ラベル。**回答率が評点より先に効く。**
 *
 * 評点が無いとき（AI 提案をまだ受け取っていない、または回答率が足りず提案を求めて
 * いないとき）は `null` を返す — ただし「参加入力未済」だけは評点を要らないので、
 * 提案の前でも出る。回答が揃っていないことは AI に訊かなくても表から分かる。
 */
export function labelFor(
  metrics: CandidateMetrics,
  score: number | null,
): AiEvaluationLabel | null {
  if (metrics.responseRate < UNANSWERED_RESPONSE_RATE) return 'unanswered';
  if (score === null) return null;
  if (score >= SCORE_THRESHOLDS.recommended) return 'recommended';
  if (score >= SCORE_THRESHOLDS.backup) return 'backup';
  if (score >= SCORE_THRESHOLDS.consider) return 'consider';
  return 'rejected';
}

/** 画面が候補日程ひとつについて描くのに要るもの一式。 */
export type CandidateAssessment = {
  metrics: CandidateMetrics;
  /** AI が付けた評点。提案を受け取っていなければ `null`。 */
  score: number | null;
  /** AI が書いた根拠。提案を受け取っていなければ `null`。 */
  comment: string | null;
  label: AiEvaluationLabel | null;
};

/**
 * 参加可否表と AI の評点を突き合わせ、候補日程ごとの見え方を作る。並びは入力のまま。
 *
 * `evaluations` に `null` を渡せる（提案の前）。提案の有無で画面が2通りの組み立てを
 * 持たずに済むようにする — 「参加入力未済」と集計値は提案が無くても出るので、
 * 分けると同じ数え方を2箇所に書くことになる。
 */
export function assessCandidates(
  input: RecommendScheduleInput,
  evaluations: readonly CandidateEvaluation[] | null,
): CandidateAssessment[] {
  const evaluationOf = new Map(
    evaluations?.map((entry) => [entry.candidate_id, entry]) ?? [],
  );
  return summarizeTable(input).map((metrics) => {
    const evaluation = evaluationOf.get(metrics.candidateId);
    const score = evaluation?.score ?? null;
    return {
      metrics,
      score,
      comment: evaluation?.comment ?? null,
      label: labelFor(metrics, score),
    };
  });
}

/**
 * AI の提案から導く初期選択（ADR-0007）。**開催日は「推奨」のうち最高評点、
 * 予備日は「予備に提案」のもの。**
 *
 * 開催日が決まらないこと（`null`）がある。全候補日程が「要検討」以下だった場合で、
 * そこで無理に1つ選ぶと、AI が推していない候補日程に「AIが生成」の印が付く。
 *
 * 同点は設計書 7.2節の順で捌く — 日時が早いほう、それも同じなら現地で参加できる
 * 人数が多いほう。**どちらの観点も AI には訊かない**。訊けば評点と食い違う組が返る。
 */
export type ScheduleSelection = {
  hostCandidateId: string | null;
  backupCandidateIds: string[];
};

export function initialSelection(
  input: RecommendScheduleInput,
  evaluations: readonly CandidateEvaluation[],
): ScheduleSelection {
  const assessments = assessCandidates(input, evaluations);
  const entries = input.candidates.map((candidate, index) => ({
    candidate,
    assessment: assessments[index],
  }));

  const recommended = entries
    .filter((entry) => entry.assessment.label === 'recommended')
    .sort((a, b) => {
      const byScore = (b.assessment.score ?? 0) - (a.assessment.score ?? 0);
      if (byScore !== 0) return byScore;
      const byStart = startsAt(a.candidate).localeCompare(
        startsAt(b.candidate),
      );
      if (byStart !== 0) return byStart;
      return (
        b.assessment.metrics.attendOnsiteCount -
        a.assessment.metrics.attendOnsiteCount
      );
    });

  return {
    hostCandidateId: recommended[0]?.candidate.id ?? null,
    backupCandidateIds: entries
      .filter((entry) => entry.assessment.label === 'backup')
      .map((entry) => entry.candidate.id),
  };
}

/** 同点を捌くための並べ替え用の鍵。日付と開始時刻はどちらも桁が揃っているので辞書順でよい。 */
function startsAt(candidate: TableCandidate): string {
  return `${candidate.date}T${candidate.start_time}`;
}
