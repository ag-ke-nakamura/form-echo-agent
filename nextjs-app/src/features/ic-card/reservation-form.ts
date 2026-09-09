import type {
  ParseReservationInput,
  ParseReservationOutput,
  RoundTrip,
} from "@/lib/contracts/types";
import type {
  ApplyReport,
  FieldSource,
} from "@/components/ai-assistant/field-source";
import type { BreakdownSection, PreviewItem } from "@/lib/ai-preview";

/**
 * 交通ICタブのフォームの組み立て（#38・#65）。
 *
 * WHY 画面から切り離すか: ここには写す規則が3つ重なっている（読み取れなかった欄は
 * 触らない・手で直した欄は上書きしない・同じ値は「更新」に数えない）。JSX の中に
 * 置くと、応答を何度も往復させない限りどれも確かめられない
 * （`nextjs-app/CLAUDE.md`「`.tsx` に判断が育ったら隣の `.ts` へ出す」）。
 * 参加可否タブの `availability-form.ts`・候補日提案タブの `recommend-form.ts` と同じ形。
 *
 * 欄の値域そのものは出力契約が持つ（`contracts/outputs.ts`）。ここに残るのは画面だけが
 * 要るもの — 欄の表示名、選択肢の文言、写す規則である。
 *
 * **タブの状態は同行者とICカード利用枚数まで含めてここにある**（`ReservationState`。#167）。
 * 同行者の人数は出力契約に載る（#176）が氏名は載らず、利用枚数は行数から導く — どちらも
 * 行の足し引きという判断を持つので画面の中には置かない。
 */

export type FieldName =
  | "round_trip"
  | "borrow_at"
  | "return_at"
  | "origin"
  | "destination"
  | "route"
  | "transport_cost"
  | "purpose";

/**
 * 交通ICのフォームの状態モデル。スカラーの平坦なマップ。
 * 候補日程タブとは形が違うので共有しない（共有するのは `FieldSource` だけ）。
 */
export type FormState = Record<
  FieldName,
  { value: string; source: FieldSource }
>;

/** 往復区分の既定値（#168）。出張はほとんど往復なので指南書がこれをプレプリントする。 */
export const DEFAULT_ROUND_TRIP: RoundTrip = "round";

/**
 * 出発地の既定値（#171）。ほとんどの申請がここから始まる。
 *
 * **都道府県を添えるのは霞ヶ関駅が全国に1つではないため**（埼玉県川越市にもある）。
 * この文字列は与件としてそのまま AI へ渡る（ADR-0017）ので、曖昧なまま渡すと
 * 経路検索が別の駅を引きうる。
 */
export const DEFAULT_ORIGIN = "霞ヶ関駅（東京都）";

/**
 * 出発地・目的地の入力候補（#171）。よく使う7駅。
 *
 * **値域ではない。** 訪問先は建物名・会社名で伝えられることが多く、駅すぱあとではなく
 * AI を使う理由がそこにあるので、同じ欄に自由記述もできる（`<datalist>`）。契約に
 * 載せると、載っていない目的地を職員が打てなくなる。
 *
 * 選択肢から選んだ値は `setFieldValue` を通るので `"manual"` に落ちる — 7駅から
 * 選んだ意思は追加指示より重く、食い違えば AI が聞き返す側に回る（ADR-0018）。
 * **だから霞ヶ関は一覧でも `DEFAULT_ORIGIN` と同じ都道府県付きの表記にする。** 選ぶと
 * `is_manual: true` で渡り、AI が都道府県を補えなくなるので、曖昧さは既定値より
 * 一覧の側でこそ重い。表記が割れていると副作用がもう1つある — `<datalist>` は
 * **いまの入力値で候補を絞る**ので、プレプリントの入った出発地欄では7駅が1件も出ない。
 */
export const PLACE_SUGGESTIONS: readonly string[] = [
  DEFAULT_ORIGIN,
  "国会議事堂前駅",
  "永田町駅",
  "虎ノ門駅",
  "赤坂見附駅",
  "桜田門駅",
  "溜池山王駅",
];

/** 出発地・目的地のプレースホルダ（#171）。駅名に限らないことを職員に言う。 */
export const PLACE_PLACEHOLDER = "駅名・地名・建物名など";

/**
 * 初期状態は「既定値」（ADR-0018）。**`"manual"` と書くと AI が一切上書きできない** —
 * 手を触れていない欄が「手入力だから」という理由で守られてしまう。
 */
export const EMPTY_FORM: FormState = {
  /*
    往復区分だけは空で始まらない。出張はほとんど往復なので指南書が往復のプレプリントを
    求めており、2択のラジオに「未選択」を足すと、職員が選んでいない状態と片道を選んだ
    状態が同じ見た目になる（#168）。
  */
  round_trip: { value: DEFAULT_ROUND_TRIP, source: "default" },
  borrow_at: { value: "", source: "default" },
  return_at: { value: "", source: "default" },
  /*
    出発地だけプレプリントする（#171）。目的地は申請ごとに違うので、置くと毎回
    消してから打つことになる。`"default"` なので AI が追加指示（「新宿から行きます」）で
    直せる — `"manual"` だと職員が手を触れていない値が守られてしまう（ADR-0018）。
  */
  origin: { value: DEFAULT_ORIGIN, source: "default" },
  destination: { value: "", source: "default" },
  route: { value: "", source: "default" },
  transport_cost: { value: "", source: "default" },
  purpose: { value: "", source: "default" },
};

/**
 * 同行者の行ひとつ。**氏名は AI が埋めない**ので `FieldSource` を持たない（#176）。
 *
 * AI が作れるのは空の行までで、氏名は契約に載らない（参加者名をブラウザに留める
 * ADR-0008 と同じ種類のデータ）。守る単位が「行の有無」であって欄ではないので、
 * 出どころの印を行に付けても反映の判断には使えない。
 *
 * `id` は React の key にしか使わない。同姓が並びうるので氏名は識別子にできず、
 * 行の位置も足し引きで動くので使えない。
 */
export type CompanionRow = { id: string; name: string };

/**
 * 交通ICタブの状態。AI が埋める欄（`fields`）と AI が埋めない欄（同行者・ICカード
 * 利用枚数）を1つに持つ。
 *
 * WHY 同行者と利用枚数を `fields` の中に入れないか: どちらも欄として写す対象ではない。
 * 同行者は**行の有無**で守り（#176）、利用枚数は行数から**導く**ので、`fields` に
 * 混ぜると `applyToForm` の写す規則（手入力を守る・同じ値は数えない）が掛かる欄に見える。
 *
 * WHY 画面（`.tsx`）から出すか: 両方に判断が乗っている（#176 が「同行者の人数から行を
 * 作る」「利用枚数を行数から導く」を実装した）。画面が状態を持ったままだと、その判断は
 * **画面を描かない限り確かめられない**（#167）。
 */
export type ReservationState = {
  fields: FormState;
  companions: CompanionRow[];
  /**
   * 次の行に配る番号。**行を消しても戻さない。** 戻すと、消した行と新しく足した行が
   * React から同じものに見え、入力中の氏名が別の行へ移る。
   */
  nextCompanionNumber: number;
  /**
   * 職員が手で入れた利用枚数（#176）。**`null` は「同行者の行数から導く」。**
   *
   * WHY 値そのものを持たないか: 導出（行数 + 1）を状態として持つと、行が増えるたびに
   * 書き戻す場所が要り、書き忘れた経路でだけ食い違う。持たなければ食い違いようがない。
   *
   * WHY 空文字と `null` を分けるか: 職員が「消す」で空にしたのは意図なので、行が
   * 増えても埋め直さない（ADR-0018 が欄に対して決めたことと同じ）。
   */
  cardCountOverride: string | null;
};

/**
 * 初期状態。同行者の行を1つも持たないのは、同行者がいない出張のほうが普通で、空行が
 * 1つあると「埋めるべき欄」に見えるため（#68）。
 */
export const EMPTY_RESERVATION: ReservationState = {
  fields: EMPTY_FORM,
  companions: [],
  nextCompanionNumber: 0,
  cardCountOverride: null,
};

/**
 * 「最初からやり直す」（#65）。**AI 由来の欄だけを消す操作ではなく、フォームを初期状態
 * へ戻す操作**なので、同行者の行も消え、利用枚数の手入力の固定も外れる。
 *
 * **行番号だけは持ち越す**（初期状態と違うのはここだけ）。0 に戻すと、消えた行と戻した
 * 後に足した行が React から同じものに見える。戻した直後は行が無いので今は衝突しないが、
 * それは「番号を再利用しない」を行数に依存させることであり、依存させる理由が無い。
 */
export function resetReservation(current: ReservationState): ReservationState {
  return {
    ...EMPTY_RESERVATION,
    nextCompanionNumber: current.nextCompanionNumber,
  };
}

/**
 * 手で入れた欄（#38）。**`source` を `"manual"` にするのがこの関数の仕事**で、
 * `applyToForm` が `"ai"` を入れるのと対になる。この印が「反映で上書きされる範囲」と
 * `isPreserved` の判定の両方を決めるので、画面の中で組み立てない。
 */
export function setFieldValue(
  current: ReservationState,
  name: FieldName,
  value: string,
): ReservationState {
  return {
    ...current,
    fields: { ...current.fields, [name]: { value, source: "manual" } },
  };
}

/**
 * ICカードの利用枚数（#176）。**同行者の行数 + 1**（職員自身のぶん）。
 *
 * WHY 導出か: 同じ数を2箇所に入れさせる意味がない。AI が人数から行を作るように
 * なった以上、独立した手入力欄のままだと**放置すれば必ず食い違う** — 職員は AI が
 * 2行作ったのを見てから隣の欄に手で3と打つことになる。
 *
 * 職員が触れば固定される（`cardCountOverride`）。自分のICカードを持っている同行者が
 * いる回があるので、導出を上書きできないと詰む。
 */
export function cardCount(state: ReservationState): string {
  return state.cardCountOverride ?? String(state.companions.length + 1);
}

/** 利用枚数を手で入れる。**以降は行が増えても動かない。** */
export function setCardCount(
  current: ReservationState,
  override: string,
): ReservationState {
  return { ...current, cardCountOverride: override };
}

/** 同行者の行を末尾に足す。何人になるか決まっていないので固定の欄にできない（#68）。 */
export function addCompanion(current: ReservationState): ReservationState {
  return addCompanions(current, 1);
}

/** 空の行を `count` 行足す。番号は続きから配る（消した番号は再利用しない）。 */
function addCompanions(
  current: ReservationState,
  count: number,
): ReservationState {
  const added = Array.from({ length: count }, (_, index) => ({
    id: `companion-${current.nextCompanionNumber + index}`,
    name: "",
  }));
  return {
    ...current,
    companions: [...current.companions, ...added],
    nextCompanionNumber: current.nextCompanionNumber + count,
  };
}

export function removeCompanion(
  current: ReservationState,
  id: string,
): ReservationState {
  return {
    ...current,
    companions: current.companions.filter((row) => row.id !== id),
  };
}

export function setCompanionName(
  current: ReservationState,
  id: string,
  name: string,
): ReservationState {
  return {
    ...current,
    companions: current.companions.map((row) =>
      row.id === id ? { ...row, name } : row,
    ),
  };
}

/**
 * 欄の表示名。JSX・プレビューの一覧・反映の報告の3箇所から引く。
 *
 * 報告（`ApplyReport`）とプレビューに載せる文字列がここから来るので、片方だけ直すと
 * 画面のラベルと「更新: 出発日」の言い方が食い違う。
 */
export const FIELD_LABELS: Record<FieldName, string> = {
  round_trip: "往復区分",
  // 日付のみになった（#86）ので「日時」ではなく「日」と呼ぶ。返す日時と区別が付く。
  borrow_at: "借りる日",
  return_at: "返す日時",
  origin: "出発地",
  destination: "目的地",
  // 交通手段の選択欄を置き換える（#86。CONTEXT.md「移動経路」）。
  route: "移動経路",
  transport_cost: "交通費",
  /*
    「目的」ではなく「利用目的」と呼ぶ。目的地が同じ画面に並んでいるので、
    「目的」だと職員がどちらの欄を読んでいるのか一瞬で分からない。
  */
  purpose: "利用目的",
};

export const FIELD_NAMES = Object.keys(FIELD_LABELS) as FieldName[];

/**
 * 選択肢の欄の、契約の値から職員が読む語への対応。
 *
 * `Record<...>` で受けるのは網羅を型に見てもらうため。契約に選択肢が増えたときに
 * ここが漏れると、選択肢に出ないまま AI だけが返せる値になる。
 */
type Purpose = NonNullable<ParseReservationOutput["purpose"]>;

const PURPOSE_LABELS: Record<Purpose, string> = {
  discussion: "打ち合わせ",
  training: "研修",
  inspection: "視察",
  business_trip: "出張",
  other: "その他",
};

/** 往復区分の表示名。**ラジオに並ぶ順もこの表の順**（片道 → 往復）。 */
const ROUND_TRIP_LABELS: Record<RoundTrip, string> = {
  one_way: "片道",
  round: "往復",
};

/** 往復区分の値域。表示名の表から引く（`FIELD_NAMES` と同じ形）。 */
const ROUND_TRIP_VALUES = Object.keys(ROUND_TRIP_LABELS) as RoundTrip[];

/**
 * 選択肢から選ぶ欄。**描き方は欄ごとに違う**（利用目的は `<select>`、往復区分は
 * 2択なのでラジオ）が、契約の値から職員が読む語へ写す必要は同じ。
 */
export type ChoiceFieldName = "purpose" | "round_trip";

/**
 * 選択肢の欄の表示名の表。**プレビューと入力欄が同じ表を引く。**
 *
 * WHY 欄名で引けるようにするか: 欄ごとに表を渡していると、入力欄に別の欄の表を
 * 渡しながらラベルは利用目的、という組を型が通してしまう。欄が増えても
 * `previewValue` の分岐は増えない。
 */
export const CHOICE_LABELS: Record<ChoiceFieldName, Record<string, string>> = {
  purpose: PURPOSE_LABELS,
  round_trip: ROUND_TRIP_LABELS,
};

function isChoiceField(name: FieldName): name is ChoiceFieldName {
  return name in CHOICE_LABELS;
}

/**
 * フォームの文字列を往復区分の値域へ戻す。
 *
 * WHY 要るか: `FormState` はどの欄も文字列で持つ（欄ごとに型を割ると、写す規則が
 * 欄ごとに分かれる）。与件は値域を持つので、Runtime へ渡す手前で1度だけ戻す。
 * 書き手はラジオと `applyToForm` しかいないので実際には外れないが、外れた値を
 * そのまま送ると BFF の門が 400 を返し、その理由は画面のどこにも出ない。
 */
function toRoundTrip(value: string): RoundTrip {
  return (
    ROUND_TRIP_VALUES.find((candidate) => candidate === value) ??
    DEFAULT_ROUND_TRIP
  );
}

/**
 * Runtime へ渡す与件（ADR-0017）。**値と「職員が手で入れたか」の組で渡す**（ADR-0018）。
 *
 * 載せるのは運賃の額を決める3欄だけ（出発地・目的地・往復区分）。借りる日・返す日時・
 * 利用目的は経路計算に使わないので、手入力が守られて AI の抽出が入らなくても
 * フォームは自己矛盾しない。
 *
 * WHY 画面（`.tsx`）で組み立てないか: `is_manual` の導出が判断だからである。**`isPreserved`
 * から引く** — 「AI が直せる欄」と「画面が守る欄」は同じ条件でなければならず、2箇所に
 * 書くと片方だけ動いたときに AI が直した値が黙って捨てられる。AI が入れた値（`"ai"`）と
 * 既定値（`"default"`）がどちらも `false` になるのは、**AI バッジが「再生成で上書きされる
 * 範囲」の印でもある**から（#38）。
 */
export function reservationInput(fields: FormState): ParseReservationInput {
  const roundTrip = fields.round_trip;
  return {
    /*
      出発地・目的地は打たれた文字列をそのまま渡す（#170）。空なら空文字列で、
      「打っていない」も与件である — 何も渡さないと、AI は前回の会話に残った
      古いフォームの値を最後の与件として読む。
    */
    origin: {
      value: fields.origin.value,
      is_manual: isPreserved(fields.origin),
    },
    destination: {
      value: fields.destination.value,
      is_manual: isPreserved(fields.destination),
    },
    round_trip: {
      value: toRoundTrip(roundTrip.value),
      is_manual: isPreserved(roundTrip),
    },
  };
}

/**
 * 比較検討の末に採用された経路候補（#100）。**他候補はこの変更では画面に表示しない**
 * ので、ここで選んだ1件の `route`/`fare` だけを「移動経路」「交通費」欄へ写す。
 *
 * `is_selected` がちょうど1件であることは出力契約の `.refine()` が保証する
 * （経路候補が0件のときは何も採用されていない）。
 */
function selectedRouteCandidate(result: ParseReservationOutput) {
  return result.route_candidates.find((candidate) => candidate.is_selected);
}

/** 欄ごとの生の値。`route`/`transport_cost` は経路候補から導く2欄だけの例外。 */
function rawValue(
  name: FieldName,
  result: ParseReservationOutput,
): string | null {
  const selected = selectedRouteCandidate(result);
  if (name === "route") return selected?.route ?? null;
  if (name === "transport_cost") return selected?.fare ?? null;
  return result[name];
}

/**
 * プレビューに出す値（設計書 3.6.1節）。**フォームに入る値ではなく職員が読む文字列。**
 *
 * WHY 分けるか: 選択肢の欄（交通手段・利用目的）は契約の値（`train`）とフォームの値が
 * 同じで、職員が読む語（`鉄道`）が違う。プレビューに `train` と出すと、押す前に
 * 確認するという ADR-0006 の目的がその欄だけ果たせない。
 */
function previewValue(
  name: FieldName,
  result: ParseReservationOutput,
): string | null {
  const raw = rawValue(name, result);
  if (raw === null) return null;
  return isChoiceField(name) ? CHOICE_LABELS[name][raw] : raw;
}

/** 同行者の行の表示名。プレビューと反映の報告が同じ語を引く。 */
const COMPANIONS_LABEL = "同行者";

/**
 * 錠の理由（#176）。既定の「手入力のため変更しません」では、職員が同行者の欄の
 * どこで手入力したのかを探すことになる — 守っているのは欄ではなく行の有無である。
 *
 * 0人（「一人で行きます」）にも錠が要る。作る行が無いので押しても何も起きないのに、
 * 緑のチェックで並べると反映のボタンが生きてしまう（`hasApplicableItems`）。
 */
const COMPANIONS_PRESERVED_REASON = "同行者の行が既にあるため変更しません";

const NO_COMPANIONS_TO_ADD_REASON = "作る行はありません";

/**
 * 同行者の行に触れないか（#176）。**守る単位は欄ではなく行の有無。**
 *
 * 欄の `isPreserved` と同じ役割で、プレビューの印と `applyToReservation` の判断を
 * 1箇所から引く。2箇所に書くと、片方だけ条件が動いたときにプレビューが
 * 「行が増える」と言って増えない（またはその逆）状態になる。
 */
function companionsPreserved(current: ReservationState): boolean {
  return current.companions.length > 0;
}

/**
 * 聞き返し（黄）の分母（#168）。**この呼び出しが担う仕事だけを数える。**
 *
 * フォーム主導になった（ADR-0017）ので、追加指示を空にして生成を押すのが主な流れに
 * なる。その回は借りる日・返す日時・利用目的に言及が無く、**読み取れないのが正しい**
 * — 分母に入れたままだと、経路と運賃が返った成功の回が毎回聞き返しとして出る。
 * 残るこの2欄は AI がこの往復で調べてくるもので、欠けていれば本当に聞き返すべき回。
 */
const FARE_SEARCH_FIELDS: readonly FieldName[] = ["route", "transport_cost"];

/**
 * AI の結果をプレビューの一覧へ写す（ADR-0006）。
 *
 * **読み取れなかった欄も行として残す**（`value` が `null`）。落とすと、聞き返しの
 * 判断（`previewTone`）が「全部埋まった」と読んでしまい、何が足りないのかも
 * 画面から消える。
 *
 * **いまのフォームを見て、押しても変わらない欄に印を付ける。** 判定は `applyToForm`
 * と同じ条件（手入力かどうか）で、この2つが食い違うとプレビューが嘘になる —
 * 揃えるために条件を `isPreserved` に括ってどちらからも引く。
 */
export function reservationPreviewItems(
  result: ParseReservationOutput,
  current: ReservationState,
): PreviewItem[] {
  const items = FIELD_NAMES.map((name) => ({
    key: name,
    label: FIELD_LABELS[name],
    value: previewValue(name, result),
    preserved: isPreserved(current.fields[name]),
    optional: !FARE_SEARCH_FIELDS.includes(name),
  }));

  /*
    **人数が読み取れなかったときは行そのものを出さない**（#176）。同行者がいない
    出張のほうが普通なので、「同行者: （未入力）」が毎回並ぶと、職員は聞き返しの行を
    読み飛ばすようになる。`optional` で分母から外すだけでは足りない — 行が残る限り
    「何が足りないのか」の一覧が同行者で埋まる。
  */
  const count = result.companion_count;
  if (count === null) return items;
  const preservedReason = companionsPreserved(current)
    ? COMPANIONS_PRESERVED_REASON
    : count === 0
      ? NO_COMPANIONS_TO_ADD_REASON
      : undefined;
  return [
    ...items,
    {
      key: "companions",
      label: COMPANIONS_LABEL,
      value: `${count}人`,
      preserved: preservedReason !== undefined,
      preservedReason,
      // 人数はこの往復で AI が調べてくるものではない（運賃と違い、書いていなければ
      // 読み取れないのが正しい）ので聞き返しの分母に入れない。
      optional: true,
    },
  ];
}

/**
 * 出発地・目的地・最寄が特定できなかったときに画面へ出す語（#172）。
 *
 * 契約は null で持つが、内訳の行は「出発地：（最寄：）」のように括弧だけ残すと
 * 読めない。**契約がこの4つを揃って要求するので実際には出ない** — どれかが null の
 * 回は経路候補も空になり、この内訳そのものが出ない。型のための受け皿である。
 */
const UNKNOWN_PLACE = "不明";

/** 検索条件の1行。「出発地：虎ノ門ヒルズ（最寄：虎ノ門駅）」。 */
function searchConditionLine(
  label: string,
  place: string | null,
  nearest: string | null,
): string {
  return `${label}：${place ?? UNKNOWN_PLACE}（最寄：${nearest ?? UNKNOWN_PLACE}）`;
}

/**
 * AI提案の内訳（#172。設計書 2節）。**欄の一覧とは別の領域**で、AI が何を調べて
 * なぜそれを選んだかを見せる。いま持つのは検索条件（出発地・目的地とその最寄）だけ。
 *
 * **最寄は値が同じでも省かない**（`出発地：霞ヶ関駅（最寄：霞ケ関駅）`）。出る回と
 * 出ない回があると、職員は運賃がどの区間の額なのかを必要な回に確かめられない。
 *
 * **経路候補が0件なら空を返す。** 何も調べられなかった回に見出しだけが残ると
 * 「調べたが根拠が無い」に見える。理由は AI の `message` が言う。
 */
export function reservationBreakdown(
  result: ParseReservationOutput,
): BreakdownSection[] {
  if (result.route_candidates.length === 0) return [];
  return [
    {
      key: "search-conditions",
      label: "検索条件",
      lines: [
        searchConditionLine(
          FIELD_LABELS.origin,
          result.origin,
          result.origin_nearest,
        ),
        searchConditionLine(
          FIELD_LABELS.destination,
          result.destination,
          result.destination_nearest,
        ),
      ],
    },
  ];
}

/**
 * 反映しても上書きしない欄か（#38）。
 *
 * **プレビューの印と `applyToForm` の判断を1箇所から引く。** 2箇所に書くと、片方だけ
 * 条件が動いたときにプレビューが「入る」と言って入らない（またはその逆）状態になる。
 *
 * **見るのは出どころだけで、空かどうかは見ない**（ADR-0018）。初期状態が `"default"`
 * になったので「空で `manual`」は職員が「消す」で空にした欄しか指さず、消したという
 * 意図をそのまま守れる。
 */
function isPreserved(field: FormState[FieldName]): boolean {
  return field.source === "manual";
}

/**
 * AI の出力をフォームへ写し、何を更新して何を守ったかを一緒に返す。
 *
 * **手で直した欄は上書きしない**（#38 の判断）。これで AI バッジが「再生成で
 * 上書きされる範囲」の印としても働く。代わりに、追加で指示したのに変わらない欄が
 * 出るので、守ったことを報告に載せて画面から分かるようにする。
 *
 * **「消す」で空にした欄は空のまま残る**（ADR-0018）。それは `{ value: "",
 * source: "manual" }` で、初期状態の `"default"` と区別が付くため。消したのには意図が
 * あるので、報告の「守った」側に出る。
 */
function applyToForm(
  current: FormState,
  result: ParseReservationOutput,
): { next: FormState; report: ApplyReport } {
  const next = { ...current };
  const updated: string[] = [];
  const preserved: string[] = [];

  for (const name of FIELD_NAMES) {
    const raw = rawValue(name, result);
    // 読み取れなかった項目（null）は触らない。職員が先に手で埋めていた値を
    // AI が空に戻してしまうのを避ける。
    if (raw === null) continue;
    const field = current[name];
    if (isPreserved(field)) {
      preserved.push(FIELD_LABELS[name]);
      continue;
    }
    // 同じ値なら「更新」に数えない。読み取り直した項目を毎回並べると、実際に
    // 変わった項目が埋もれる（追加の指示は普通1〜2項目しか動かさない）。
    if (field.value === raw) continue;
    // 日付・日時は出力契約が YYYY-MM-DD / YYYY-MM-DDTHH:mm を保証するので、
    // `<input type="date">` / `<input type="datetime-local">` へそのまま渡せる。整形は要らない。
    next[name] = { value: raw, source: "ai" };
    updated.push(FIELD_LABELS[name]);
  }

  return { next, report: { updated, preserved } };
}

/**
 * AI の出力をタブの状態へ写す（#176）。**欄と同行者の行を1回で写す。**
 *
 * WHY 1つの関数か: 反映の報告（`ApplyReport`）は欄と行をまたいで1つである。呼ぶ側で
 * 2つの報告を継ぎ合わせると、その継ぎ方（どちらを先に並べるか・守った行をどちらに
 * 載せるか）が画面の中の判断になる。
 *
 * 同行者の規則は3つ。**人数が読み取れなければ触らない**（同行者がいない出張のほうが
 * 普通なので、読み取れないことは失敗ではない）。**行が1つでもあれば触らない**（職員が
 * 名前を書いた行を消さない。守ったことは報告に出る）。**総数に合わせて減らさない。**
 * 氏名は契約に載らない（ADR-0008 と同じ種類のデータ）ので、作るのは空の行である。
 */
export function applyToReservation(
  current: ReservationState,
  result: ParseReservationOutput,
): { next: ReservationState; report: ApplyReport } {
  const { next: fields, report } = applyToForm(current.fields, result);
  const withFields = { ...current, fields };
  const count = result.companion_count;

  if (count === null) return { next: withFields, report };
  /*
    行があれば人数によらず守る。「一人で行きます」（0人）と読めた回も同じで、AI の
    読みとフォームが食い違ったまま行が残るのだから、守ったことを報告に出す。
  */
  if (companionsPreserved(current)) {
    return {
      next: withFields,
      report: { ...report, preserved: [...report.preserved, COMPANIONS_LABEL] },
    };
  }
  // 行が無く0人なら作る行が無い。守ったわけでも更新したわけでもないので報告に出ない。
  if (count === 0) return { next: withFields, report };
  return {
    next: addCompanions(withFields, count),
    report: { ...report, updated: [...report.updated, COMPANIONS_LABEL] },
  };
}
