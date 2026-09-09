import type { ParseReservationOutput } from "@/lib/contracts/types";
import type {
  ApplyReport,
  FieldSource,
} from "@/components/ai-assistant/field-source";
import type { PreviewItem } from "@/lib/ai-preview";

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
 * **同行者とICカード利用枚数はここに無い**（#68）。出力契約に載せず AI にも埋めさせない
 * 欄なので、写す規則の対象にならない。状態は `reservation-panel.tsx` が持つ。
 */

export type FieldName =
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

/**
 * 初期状態は「既定値」（ADR-0018）。**`"manual"` と書くと AI が一切上書きできない** —
 * 手を触れていない欄が「手入力だから」という理由で守られてしまう。
 */
export const EMPTY_FORM: FormState = {
  borrow_at: { value: "", source: "default" },
  return_at: { value: "", source: "default" },
  origin: { value: "", source: "default" },
  destination: { value: "", source: "default" },
  route: { value: "", source: "default" },
  transport_cost: { value: "", source: "default" },
  purpose: { value: "", source: "default" },
};

/**
 * 欄の表示名。JSX・プレビューの一覧・反映の報告の3箇所から引く。
 *
 * 報告（`ApplyReport`）とプレビューに載せる文字列がここから来るので、片方だけ直すと
 * 画面のラベルと「更新: 出発日」の言い方が食い違う。
 */
export const FIELD_LABELS: Record<FieldName, string> = {
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
 * ここが漏れると、`<select>` にその選択肢が出ないまま AI だけが返せる値になる。
 */
type Purpose = NonNullable<ParseReservationOutput["purpose"]>;

const PURPOSE_LABELS: Record<Purpose, string> = {
  discussion: "打ち合わせ",
  training: "研修",
  inspection: "視察",
  business_trip: "出張",
  other: "その他",
};

/** 選択肢を持つ欄。`<select>` で描く欄と、表示名に写す欄はいつも同じ。 */
export type SelectFieldName = "purpose";

/**
 * 選択肢の欄の表示名の表。**プレビューと `<select>` が同じ表を引く。**
 *
 * WHY 欄名で引けるようにするか: 欄ごとに表を渡していると、`<select>` に別の欄の
 * 表を渡しながらラベルは利用目的、という組を型が通してしまう。欄が増えても
 * `previewValue` の分岐は増えない。
 */
export const SELECT_LABELS: Record<SelectFieldName, Record<string, string>> = {
  purpose: PURPOSE_LABELS,
};

function isSelectField(name: FieldName): name is SelectFieldName {
  return name in SELECT_LABELS;
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
  return isSelectField(name) ? SELECT_LABELS[name][raw] : raw;
}

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
  current: FormState,
): PreviewItem[] {
  return FIELD_NAMES.map((name) => ({
    key: name,
    label: FIELD_LABELS[name],
    value: previewValue(name, result),
    preserved: isPreserved(current[name]),
  }));
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
export function applyToForm(
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
