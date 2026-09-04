// 値として引くのは `meeting.ts` だけ（zod を持たないので SSG のバンドルに乗らない）。
/*
  候補日程の型だけコンポーネント側から引く。**`import type` なので実行時には消え**、
  この module が候補日程タブを読み込むことはない（vitest も同じ）。同じ形をここで
  書き直すと、入力契約に欄が増えたときに型検査がこちらまで届かなくなる。
*/
import type { SelectedCandidate } from "../candidates-panel";
import type { ApplyReport, FieldSource } from "../field-source";
import type { ParseAvailabilityOutput } from "@contracts/index.js";
import type { Availability, MeetingFormat } from "@contracts/meeting";
import { AVAILABILITY_ORDER, isAttending } from "@contracts/meeting";
import { candidateRangeText } from "./meeting-info";

/**
 * 参加可否回答フォームの組み立て（#70）。
 *
 * WHY 画面から切り離すか: ここにあるのは**参加形式が参加可否の選択肢を決める**という
 * 取り決めと、候補日程の並べ方である。JSX の中に埋め込むと、参加形式を切り替えて
 * 画面を描かない限り確かめられない（`meeting-info.ts` の表示文字列と同じ理由）。
 *
 * 値域そのものは `contracts/meeting.ts` にある。ここに残るのは画面だけが要るもの —
 * ラジオの文言、畳んだときの寄せ先、日付でのグループ化である。
 */

export type AvailabilityChoice = {
  value: Availability;
  label: string;
};

/**
 * 参加可否のラジオの文言（設計書 2.1節・6.4節）。
 *
 * `meeting-info.ts` の `AVAILABILITY_LABELS`（「現地」「リモート」）とは別に持つ。
 * あちらは参加可否表のセルで、候補日程 × 参加者の升目に収める必要がある。こちらは
 * 参加者が選ぶ選択肢なので、何を選ぶのかが単独で読めなければならない。
 */
const CHOICE_LABELS: Record<Availability, string> = {
  attend_onsite: "現地で出席",
  attend_remote: "リモートで出席",
  absent: "欠席",
  undecided: "未定",
};

/** 出席が1通りしかない会議での文言（設計書 6.4節）。 */
const COLLAPSED_ATTEND_LABEL = "出席";

/**
 * その参加形式で出席を表す値。**畳んだときの寄せ先でもある。**
 *
 * WHY 表で持つか: 「現地のみなら現地出席」という対応を選択肢の組み立てと AI 出力の
 * 正規化の2箇所に書くと、片方だけがオンラインのみを取り違えたときに、選べない値が
 * ラジオへ入る（どのラジオも選ばれていない状態になり、参加者からは AI が何も
 * 判定しなかったように見える）。
 */
const ATTENDING_FORM: Record<MeetingFormat, Availability | null> = {
  hybrid: null,
  onsite: "attend_onsite",
  online: "attend_remote",
};

/**
 * その参加形式で参加者に見せる参加可否の選択肢（`CONTEXT.md`「参加形式」）。
 *
 * ハイブリッドは4つ、現地のみ／オンラインのみは3つに畳む。畳むのは**出席の2通りだけ**
 * で、欠席と未定はどの参加形式でも答えられる — 未定は参加者が答えた結果であって、
 * 会議の性質から消える選択肢ではない。
 *
 * 並びは `AVAILABILITY_ORDER` から導く。画面側で並べ直すと、値域に値が足されたときに
 * 選択肢に現れない値ができる。
 */
export function availabilityChoicesFor(
  format: MeetingFormat,
): readonly AvailabilityChoice[] {
  const attending = ATTENDING_FORM[format];
  if (attending === null) {
    return AVAILABILITY_ORDER.map((value) => ({
      value,
      label: CHOICE_LABELS[value],
    }));
  }

  return AVAILABILITY_ORDER.filter(
    (value) => value === attending || !isAttending(value),
  ).map((value) => ({
    value,
    label: value === attending ? COLLAPSED_ATTEND_LABEL : CHOICE_LABELS[value],
  }));
}

/**
 * AI が返した参加可否を、その参加形式で選べる値へ寄せる。
 *
 * WHY 要るか: 出力契約は参加形式を知らないので、AI は現地のみの会議にも
 * `attend_remote` を返せてしまう。そのまま入れると畳んだ選択肢のどれにも当たらず、
 * **ラジオが空のまま「AI判定」バッジだけが付く**。寄せる先は出席のもう1通りなので、
 * 参加者の答え（出席する）は失われない。
 */
export function normalizeAvailability(
  format: MeetingFormat,
  availability: Availability,
): Availability {
  const attending = ATTENDING_FORM[format];
  if (attending === null || !isAttending(availability)) {
    return availability;
  }
  return attending;
}

export type CandidateGroup = {
  date: string;
  candidates: SelectedCandidate[];
};

/**
 * 候補日程を日付で束ねる（設計書 2.2節「日付グループごと」）。
 *
 * WHY: 職員の1クリックが候補日程になった結果（#69）、**同じ日に複数の候補日程が
 * 普通に発生する**。束ねずに並べると同じ日付の見出しが繰り返され、参加者は
 * どれがどの日の話なのかを読み取れない。
 *
 * 並べ替えるのは、候補日程タブが職員の足した順に並んでいるため。日付が前後したまま
 * 出すと、参加者は自分の予定と突き合わせる順路を持てない。
 */
export function groupCandidatesByDate(
  candidates: readonly SelectedCandidate[],
): CandidateGroup[] {
  const groups = new Map<string, SelectedCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.date);
    if (group === undefined) {
      groups.set(candidate.date, [candidate]);
    } else {
      group.push(candidate);
    }
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, grouped]) => ({
      date,
      candidates: grouped.sort((left, right) =>
        left.start_time.localeCompare(right.start_time),
      ),
    }));
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * 日付グループの見出し（設計書 4.6.1節の `M月D日(曜)`）。
 *
 * WHY 曜日を出すか: 参加者が自分の予定と突き合わせる単位は曜日であることが多い
 * （「火曜は毎週埋まっている」）。ISO の日付だけだと、参加者は毎回カレンダーを
 * 開いて数え直すことになる。
 *
 * `Intl` を使わないのは SSG のため。ビルド環境とブラウザでロケールが違うと、
 * ビルド時に描いた HTML と初回描画が食い違う。
 */
export function dateHeadingText(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  // 桁揃えの緩さ（`2026-1-1`）を落とす。`isCalendarDate`（契約側）と同じ突き合わせ。
  if (!parsed.toISOString().startsWith(`${date}T`)) return date;

  return `${parsed.getUTCMonth() + 1}月${parsed.getUTCDate()}日(${WEEKDAYS[parsed.getUTCDay()]})`;
}

/**
 * 候補日程ひとつの表示名。反映の報告と聞き返しの一覧が引く。
 *
 * 日付まで含めるのは、どちらも**日付グループの外**に出る文字列だから。時間帯だけを
 * 挙げると、同じ時刻の候補日程が別の日に2つあるときに区別が付かない。
 */
export function candidateLabel(
  candidate: SelectedCandidate,
  durationMinutes: number,
): string {
  return `${dateHeadingText(candidate.date)} ${candidateRangeText(
    candidate.start_time,
    durationMinutes,
  )}`;
}

/**
 * 直近の応答が判定できなかった候補日程（設計書 4.6.3節の聞き返し）。
 *
 * WHY 導けるものを関数にするか: 判定できなかったことは出力契約では**要素の不在**で
 * しか表れないので、「返らなかったもの」を候補日程の一覧から引き算するのが唯一の
 * 求め方になる。引き算の条件を間違えると、既に答えた候補日程まで聞き返す（言い直しの
 * たびに全件を訊く）か、聞き返しが1件も出なくなるかのどちらかになり、どちらも画面を
 * 描いて往復させない限り気付かない。
 *
 * **まだ回答の無いものだけを挙げる。** 前の往復で AI が判定した分や参加者が手で
 * 選んだ分は、今回の応答に載っていなくても答えは画面にある。
 */
export function unjudgedCandidates(
  candidates: readonly SelectedCandidate[],
  judgedCandidateIds: readonly string[],
  answeredCandidateIds: readonly string[],
): SelectedCandidate[] {
  const judged = new Set(judgedCandidateIds);
  const answered = new Set(answeredCandidateIds);
  return candidates.filter(
    (candidate) => !judged.has(candidate.id) && !answered.has(candidate.id),
  );
}

/**
 * 候補日程ひとつへの回答。**未回答はこの型では表さない**（`AvailabilityAnswers` に
 * キーが無いことで表す）。
 *
 * WHY 画面に出る印が1つなのに出どころを2つ持つか: 印が示すのは**参加可否が AI 由来か
 * どうか**である（設計書 6.5節）。備考を手で書き直しても「AI判定」バッジは残る —
 * 参加可否そのものは AI が判定したままで、そこを隠すと統制「透明性」が守りたい向きと
 * 逆になる。一方で「手で直した値は AI の再生成で潰さない」（#38）は備考にも要る。
 * 出どころを1つにすると、備考を手で書いたのに印が「AI」のままなので保護から漏れ、
 * **次の応答が参加者の書いた事情を黙って消す。**
 */
export type AvailabilityAnswer = {
  availability: Availability;
  source: FieldSource;
  /** 備考（`CONTEXT.md`「備考」）。書かれていなければ空文字。 */
  note: string;
  noteSource: FieldSource;
};

/** 候補日程の識別子をキーにした回答。未回答はキーが無いことで表す。 */
export type AvailabilityAnswers = Record<string, AvailabilityAnswer>;

/** 反映のときに要る会議の与件。参加形式が寄せ先を、所要時間が表示名を決める。 */
type ApplyContext = {
  candidates: readonly SelectedCandidate[];
  format: MeetingFormat;
  durationMinutes: number;
};

/**
 * AI が返した参加可否を回答へ写す。**新しい回答と、何をしたかの報告を返す。**
 *
 * WHY 画面から出すか: ここには守る規則が3つ重なっている（手で選んだ参加可否は
 * 上書きしない・手で書いた備考は消さない・畳んだ選択肢に無い値は寄せる）。JSX の
 * 中に置くと、往復を実際に何度も繰り返さない限りどれも確かめられない
 * （`nextjs-app/CLAUDE.md`「判断を持つコードが `app/*.tsx` に育ったら…`app/lib` へ出す」）。
 *
 * **当てる先が消えていた分は報告に載せる。** 入力に無い識別子は契約が弾く
 * （`findAvailabilityMismatch`）が、応答を待つ間に職員が候補日程を消していることは
 * ありうる。黙って落とすと、指示が届かなかったのと見分けが付かない。
 */
export function applyAvailabilityResult(
  answers: Readonly<AvailabilityAnswers>,
  result: ParseAvailabilityOutput,
  { candidates, format, durationMinutes }: ApplyContext,
): {
  answers: AvailabilityAnswers;
  report: ApplyReport;
  /** 直近の応答が実際に判定した候補日程。聞き返しの引き算に使う。 */
  judgedCandidateIds: string[];
} {
  const known = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const next: AvailabilityAnswers = { ...answers };
  const updated: string[] = [];
  const preserved: string[] = [];
  const dropped: string[] = [];
  const judgedCandidateIds: string[] = [];

  for (const entry of result.availability) {
    const candidate = known.get(entry.candidate_id);
    if (candidate === undefined) {
      dropped.push(entry.candidate_id);
      continue;
    }
    judgedCandidateIds.push(entry.candidate_id);

    const label = candidateLabel(candidate, durationMinutes);
    const current = next[entry.candidate_id];
    // 手で選んだ可否は本人の予定そのもので、自然文からの読み取りより確か（#38）。
    if (current?.source === "manual") {
      preserved.push(label);
      continue;
    }

    const keepsNote = current?.noteSource === "manual";
    next[entry.candidate_id] = {
      availability: normalizeAvailability(format, entry.availability),
      source: "ai",
      note: keepsNote ? current.note : (entry.note ?? ""),
      noteSource: keepsNote ? "manual" : "ai",
    };
    updated.push(
      keepsNote && current.note !== "" ? `${label}（備考は保持）` : label,
    );
  }

  return {
    answers: next,
    report: { updated, preserved, dropped },
    judgedCandidateIds,
  };
}
