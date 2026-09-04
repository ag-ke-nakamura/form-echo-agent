import type { FieldSource } from "../field-source";
import { candidateLimitReason } from "./candidate-limit";
import { candidateLabel, dateHeadingText, weekdayOf } from "./meeting-info";

/**
 * カレンダーのスロット ⇔ 候補日程の変換（#69）。
 *
 * WHY 画面から切り離すか: ここにあるのは**職員の1クリックが候補日程になる**という
 * 取り決めそのものである（`CONTEXT.md`「スロット」）。スロットは30分の升目という
 * 表示単位で、選択単位ではない。クリックの受け付け（重なり・業務時間への収まり）と
 * 被覆（どの升目がどの候補日程のものか）を JSX の中に置くと、所要時間を変えながら
 * 何度もクリックしない限り確かめられない。
 *
 * 状態モデル（`CalendarCandidate`）もここにある。純関数がすべてこの形を受けて返すので、
 * タブ側（`candidates-panel.tsx`）に置くと `app/lib` から掘りに行くことになる。
 */

/** カレンダーが見せる日数（設計書 2.1節「2週間カレンダー」）。 */
const CALENDAR_DAY_COUNT = 14;

/**
 * カレンダーの日付列。**起点は職員が見ている「今日」**で、週送りは無い（#64 Out of Scope）。
 *
 * `Intl` も現地時刻の足し算も使わず UTC で日を進める（`meeting-info.ts` の `weekdayOf` と
 * 同じ事情 — SSG なのでビルド環境とブラウザでロケールが違う）。起点だけは現地時刻で
 * 決める（`isoDateOf`）ので、日本時間の早朝に開いても前日から始まらない。
 */
export function calendarDays(anchorDate: string): string[] {
  const anchor = new Date(`${anchorDate}T00:00:00Z`);
  return Array.from({ length: CALENDAR_DAY_COUNT }, (_, offset) => {
    const day = new Date(anchor);
    day.setUTCDate(day.getUTCDate() + offset);
    return day.toISOString().slice(0, 10);
  });
}

/** 升目の刻み（分）。`DURATION_OPTIONS` が30分刻みなのと同じ約束（`contracts/meeting.ts`）。 */
const SLOT_MINUTES = 30;

/** 業務時間の始まりと終わり（設計書 2.1節。早朝表示／夜間表示は #64 Out of Scope）。 */
const BUSINESS_START_MINUTES = 9 * 60;
const BUSINESS_END_MINUTES = 18 * 60;

function minutesOf(time: string): number | null {
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  return hours * 60 + minutes;
}

function timeOf(minutes: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/**
 * 升目の開始時刻。**候補日程が始まれる位置の一覧でもある。**
 *
 * 終端（18:00）を含めない。含めると、どの所要時間でも業務時間内に収まらない行が
 * 並ぶことになる。
 */
export const SLOT_START_TIMES: readonly string[] = Array.from(
  { length: (BUSINESS_END_MINUTES - BUSINESS_START_MINUTES) / SLOT_MINUTES },
  (_, index) => timeOf(BUSINESS_START_MINUTES + index * SLOT_MINUTES),
);

/**
 * カレンダーが選んでいる候補日程ひとつ。
 *
 * **終了時刻を持たない**（ADR-0005）。終わる時刻は会議の所要時間から導くので、
 * 所要時間を変えると既に選んだ候補日程の長さが全部変わる（#69 の受け入れ条件）—
 * 状態を書き換えずにそうなるのは、長さがここに無いからである。
 *
 * `source` は候補日程ごとに1つ。交通ICのように欄ごとの印を持たないのは、カレンダーで
 * 直せるのが「選ぶ・解除する」だけで、欄を部分的に書き換える余地が無いため。AI が
 * 選んだ候補日程は緑のボーダーで区別する（設計書 5.2節の案B）。
 */
export type CalendarCandidate = {
  id: string;
  date: string;
  start_time: string;
  source: FieldSource;
};

/** クリックされた升目。 */
export type Slot = {
  date: string;
  start_time: string;
};

/**
 * カレンダーが持っている与件。**受け付けの判定はこの2つ抜きには決まらない。**
 *
 * WHY 組で持つか: 所要時間と表示範囲はいつも一緒に運ばれる（クリックの受け付け・
 * AI の反映・プレビューの3経路が同じ2つを要る）。引数を並べ続けると、呼び出し側が
 * 順番を取り違えても型検査を通る組み合わせができる。
 */
export type CalendarContext = {
  durationMinutes: number;
  /** 表示している日付の列（`calendarDays`）。**職員が選べる日付はこれだけ。** */
  days: readonly string[];
};

/**
 * その升目を候補日程として受け付けられるか。**受け付けられない理由を返す。**
 *
 * WHY 1つの梯子か: 職員のクリックと AI の反映が同じ判定を引く必要がある
 * （`candidates-form.ts`）。別に書くと、クリックでは作れない状態が AI 経由で入る。
 * クリックは升目から来るので日付と時刻の2段は素通りするが、AI は暦から日時を作るので
 * そこで断られる。
 *
 * 順番には意味がある。件数の上限が先（そこで詰まっているなら他の理由を言っても
 * 直せない）、次に画面に置けるかどうか、最後に既にあるものとの重なり。
 */
export function slotRejection(
  candidates: readonly Slot[],
  slot: Slot,
  { durationMinutes, days }: CalendarContext,
): string | null {
  /*
    上限の判断と文言は `candidate-limit.ts` に1箇所だけ置く（足す側と AI へ送る側の
    両方が引く）。訊いているのは「この1件を足した件数を送れるか」である。
  */
  const limitReason = candidateLimitReason(candidates.length + 1);
  if (limitReason !== null) return limitReason;

  if (!days.includes(slot.date)) {
    if (days.length === 0) return "カレンダーの表示範囲が決まっていません";
    return `カレンダーの表示範囲 ${dateHeadingText(days[0])}〜${dateHeadingText(
      days[days.length - 1],
    )} の外です`;
  }

  if (!SLOT_START_TIMES.includes(slot.start_time)) {
    return `${timeOf(BUSINESS_START_MINUTES).replace(/^0/, "")}から${timeOf(
      BUSINESS_END_MINUTES,
    )}の30分刻みに載らない開始時刻です`;
  }

  if (!fitsInBusinessHours(slot.start_time, durationMinutes)) {
    return `所要時間${durationMinutes}分が${timeOf(BUSINESS_END_MINUTES)}までに収まりません`;
  }

  const blocker = overlappingCandidate(candidates, slot, durationMinutes);
  if (blocker !== undefined) {
    /*
      塞いでいる候補日程を名指しする。手で選んだ候補日程は升目として見えているが、
      所要時間ぶんの範囲は升目より広いので、白く見える升目が断られることがある。

      名前を括弧で囲まないのは、この理由がプレビューの錠の行では丸括弧の中に置かれる
      ため（`ai-notice.tsx`）。入れ子の括弧は読み手が対応を数えることになる。
    */
    return `既に選んだ候補日程 ${candidateLabel(blocker, durationMinutes)} と重なります`;
  }

  return null;
}

/**
 * クリックされた升目から候補日程を作る。**受け付けられなければ理由を返す。**
 *
 * WHY 理由を返すか: 黙って無視すると、職員にはクリックが効かない升目があるように
 * 見えるだけで、なぜかは画面のどこにも出ない。
 */
export function addCandidateAt(
  candidates: readonly CalendarCandidate[],
  slot: Slot,
  context: CalendarContext,
  id: string,
): { candidates: CalendarCandidate[]; rejected: string | null } {
  const rejected = slotRejection(candidates, slot, context);
  if (rejected !== null) return { candidates: [...candidates], rejected };

  return {
    candidates: [...candidates, { ...slot, id, source: "manual" }],
    rejected: null,
  };
}

/**
 * その升目から所要時間ぶんを取ると重なる候補日程。無ければ `undefined`。
 *
 * WHY 真偽ではなく相手を返すか: 断るときに相手を名指しできる。塞いでいるのが
 * カレンダーに描けない候補日程（`offGridCandidates`）だと、真偽だけでは白い升目が
 * 断られる理由を画面が説明できない。
 *
 * 突き合わせるのは升目ではなく**区間**である（開始時刻と所要時間から導く半開区間）。
 * 升目の集合で持つと、所要時間が変わったときに集合を作り直す羽目になり、候補日程が
 * 終了時刻を持たないことの利点（ADR-0005）が消える。
 *
 * AI の反映（`candidates-form.ts`）も同じ判定を引く。**加算のときに何を見送るかは
 * クリックを受け付けない条件と同じ**でなければならない — 別に書くと、クリックでは
 * 作れない重なりが AI 経由で入る。
 */
export function overlappingCandidate<TSlot extends Slot>(
  candidates: readonly TSlot[],
  slot: Slot,
  durationMinutes: number,
): TSlot | undefined {
  const start = minutesOf(slot.start_time);
  if (start === null) return undefined;

  return candidates.find((candidate) => {
    if (candidate.date !== slot.date) return false;
    const other = minutesOf(candidate.start_time);
    if (other === null) return false;
    return start < other + durationMinutes && other < start + durationMinutes;
  });
}

/**
 * その升目から所要時間ぶんを取ると業務時間内に収まるか。
 *
 * WHY クリックの側だけを縛るか: **選べる位置の定義**がこれである（グリッドは 9:00–18:00
 * しか見せず、夜間表示は #64 Out of Scope）。既にある候補日程は所要時間を伸ばせば
 * はみ出しうるが、そちらは職員が選んだものなので黙って消さない — 重なりと同じく
 * `candidateConflicts` が注意として出す。
 */
function fitsInBusinessHours(
  startTime: string,
  durationMinutes: number,
): boolean {
  const start = minutesOf(startTime);
  if (start === null) return false;
  return start + durationMinutes <= BUSINESS_END_MINUTES;
}

/**
 * 升目ひとつが誰のものか。ボーダーの引き方（設計書 5.2節の案B）と、クリックでの
 * 解除の宛先を決める。
 */
export type SlotState = {
  candidateId: string;
  /** AI が選んだ候補日程なら `ai`。緑のボーダーはこれで出す。 */
  source: FieldSource;
  /** 候補日程の先頭の升目。上のボーダーと時間帯の表示を持つ。 */
  isStart: boolean;
  /** 候補日程の末尾の升目。下のボーダーを持つ。 */
  isEnd: boolean;
};

/**
 * 升目を指す鍵。`Map` の鍵にするだけなので形は問わないが、読めるものにしておく。
 *
 * 升目そのもの（`Slot`）を受ける。日付と時刻はどちらも文字列なので、2引数で受けると
 * 呼び出し側が順番を取り違えても型検査を通る。
 */
export function slotKey(slot: Slot): string {
  return `${slot.date} ${slot.start_time}`;
}

/**
 * 候補日程の一覧から升目の被覆を導く。**所要時間を渡すたびに導き直す。**
 *
 * 集合として抱え込まないのは、候補日程が終了時刻を持たない（ADR-0005）ことを
 * 画面まで通すため。所要時間を変えると同じ候補日程が違う数の升目を占める。
 *
 * 升目に載らない候補日程（刻みから外れた開始時刻）はここに現れない。AI は 14:15 の
 * ような時刻を返しうるので、そちらは `offGridCandidates` が一覧で出す — 塗る側と
 * 一覧の側で同じ候補日程を二重に見せないよう、判定はどちらも「開始時刻が升目か」で揃える。
 *
 * 重なっている候補日程（所要時間を伸ばした後に起こる）は、**後から始まる側が升目を
 * 取る。** クリックでの解除がその升目に見えている候補日程を外す向きになる。
 */
export function candidateSlots(
  candidates: readonly CalendarCandidate[],
  durationMinutes: number,
): Map<string, SlotState> {
  const slots = new Map<string, SlotState>();

  const ordered = [...candidates].sort((left, right) =>
    left.start_time.localeCompare(right.start_time),
  );

  for (const candidate of ordered) {
    if (!SLOT_START_TIMES.includes(candidate.start_time)) continue;
    const start = minutesOf(candidate.start_time);
    if (start === null) continue;

    const covered: string[] = [];
    for (
      let minutes = start;
      minutes < start + durationMinutes && minutes < BUSINESS_END_MINUTES;
      minutes += SLOT_MINUTES
    ) {
      covered.push(timeOf(minutes));
    }

    covered.forEach((time, index) => {
      slots.set(slotKey({ date: candidate.date, start_time: time }), {
        candidateId: candidate.id,
        source: candidate.source,
        isStart: index === 0,
        isEnd: index === covered.length - 1,
      });
    });
  }

  return slots;
}

/**
 * 候補日程が抱えている不整合。**クリックでは作れないが、所要時間を伸ばすと起こる。**
 *
 * - `overlap` — 他の候補日程と所要時間ぶんの範囲が重なっている
 * - `after_hours` — 所要時間ぶんが業務時間（18:00）を越えている
 */
export type CandidateConflict = "overlap" | "after_hours";

/**
 * 不整合を抱えた候補日程と、その種類の組。
 *
 * WHY 組で返すか: 識別子から種類を引く表にすると、読む側が引けなかった場合の既定値を
 * 持つことになり、**無い理由を捏造する**（画面には「他の候補日程と重なっています」と
 * 出るのに実際は違う、という経路が開く）。
 */
export type ConflictedCandidate = {
  candidate: CalendarCandidate;
  conflict: CandidateConflict;
};

/**
 * 不整合を抱えた候補日程を挙げる。
 *
 * WHY 自動で解除しないか: 伸縮は導出なので、所要時間を長くした瞬間に職員が選んだ
 * 候補日程が互いに重なる。後から始まる側を落とせば状態は常に整合するが、**職員が
 * 選んだ候補日程が操作なしで消える。** 残して注意に出し、解除するか所要時間を戻すかを
 * 職員に選ばせる。
 *
 * 重なりは**両方**を挙げる。片方だけ挙げると、どちらを解除すれば直るのかが分からない。
 */
export function candidateConflicts(
  candidates: readonly CalendarCandidate[],
  durationMinutes: number,
): ConflictedCandidate[] {
  const conflicted: ConflictedCandidate[] = [];
  for (const candidate of candidates) {
    const others = candidates.filter((other) => other.id !== candidate.id);
    if (
      overlappingCandidate(others, candidate, durationMinutes) !== undefined
    ) {
      conflicted.push({ candidate, conflict: "overlap" });
      continue;
    }
    if (!fitsInBusinessHours(candidate.start_time, durationMinutes)) {
      conflicted.push({ candidate, conflict: "after_hours" });
    }
  }

  return conflicted;
}

/**
 * カレンダーのグリッドに描けない候補日程。**通常は空である。**
 *
 * WHY それでも要るか: 受け付けの梯子（`slotRejection`）が描けない日時を断るので、
 * クリックからも AI の反映からも入らない。残っているのは**日付が動いたとき**の経路で、
 * 起点は開いたときの「今日」に固定される一方、選んだ候補日程はそのまま残る。
 * 描けないものが混ざったことを画面が黙らないための最後の網である。
 *
 * 判定を `candidateSlots` と揃えるため、時刻の側は同じ `SLOT_START_TIMES` を見る。
 */
export function offGridCandidates(
  candidates: readonly CalendarCandidate[],
  days: readonly string[],
): CalendarCandidate[] {
  return candidates.filter(
    (candidate) =>
      !days.includes(candidate.date) ||
      !SLOT_START_TIMES.includes(candidate.start_time),
  );
}

/**
 * カレンダーの列見出し（設計書 2.1節）。14列が横に並ぶので `M/D(曜)` まで縮める。
 *
 * 参加可否タブの日付見出し（`M月D日(曜)`）とは書式が違うが、曜日は同じ1箇所から
 * 引く（`meeting-info.ts` の `weekdayOf`）。読めない日付はそのまま返す — 列が
 * 空になると、どの日の升目なのかが分からないまま押せてしまう。
 */
export function dayColumnHeading(date: string): string {
  const weekday = weekdayOf(date);
  if (weekday === null) return date;

  const [, month, day] = date.split("-").map(Number);
  return `${month}/${day}(${weekday})`;
}

/**
 * その時点の**現地時刻の**日付。カレンダーの起点に使う。
 *
 * WHY 時差を引数に取るか: 既定はブラウザの時差だが、それだけだとテストが動かす手を
 * 持てない。UTC で切ると日本時間の早朝に開いた職員のカレンダーが前日から始まる。
 *
 * 起点を決めるのはマウント後（`candidates-panel.tsx`）。SSG なのでビルド時に描いた
 * HTML と初回描画が食い違ってはならず、ビルド機の「今日」は職員の「今日」ではない。
 */
export function isoDateOf(
  now: Date,
  offsetMinutes: number = -now.getTimezoneOffset(),
): string {
  return new Date(now.getTime() + offsetMinutes * 60_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * 升目の読み上げ文（設計書 8.3節）。選択そのものは `aria-pressed` が言うので、
 * ここで言い足すのは **AI が選んだかどうか**だけである。
 *
 * WHY 語が要るか: 緑のボーダー（設計書 5.2節の案B）は色でしか出ていない。案Bを
 * 選んだ理由がアクセシビリティなので、読み上げの側に語が無いと選んだ意味が消える。
 */
export function slotLabel(slot: Slot, state: SlotState | undefined): string {
  const position = `${dayColumnHeading(slot.date)} ${slot.start_time}`;
  return state?.source === "ai" ? `${position} AIが選択` : position;
}

/**
 * 不整合を職員の言葉で言う（`candidates-panel.tsx` の注意が引く）。
 *
 * WHY 表で持つか: 値域に不整合の種類を足したときに、文言の無い種類が作れないように
 * するため（`meeting-info.ts` の表示名の表と同じ理由）。
 */
export const CONFLICT_NOTES: Record<CandidateConflict, string> = {
  overlap: "他の候補日程と重なっています",
  after_hours: "所要時間ぶんが18:00を越えます",
};
