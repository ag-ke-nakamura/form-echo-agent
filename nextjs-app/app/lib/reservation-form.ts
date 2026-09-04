import type { ParseReservationOutput } from "@contracts/index.js";
import type { ApplyReport, FieldSource } from "../field-source";
import type { PreviewItem } from "./ai-preview";

/**
 * 交通ICタブのフォームの組み立て（#38・#65）。
 *
 * WHY 画面から切り離すか: ここには写す規則が3つ重なっている（読み取れなかった欄は
 * 触らない・手で直した欄は上書きしない・同じ値は「更新」に数えない）。JSX の中に
 * 置くと、応答を何度も往復させない限りどれも確かめられない
 * （`nextjs-app/CLAUDE.md`「判断を持つコードが `app/*.tsx` に育ったら…`app/lib` へ出す」）。
 * 参加可否タブの `availability-form.ts`・候補日提案タブの `recommend-form.ts` と同じ形。
 *
 * 欄の値域そのものは出力契約が持つ（`contracts/outputs.ts`）。ここに残るのは画面だけが
 * 要るもの — 欄の表示名、交通手段の選択肢の文言、写す規則である。
 */

export type FieldName =
  | "departure_date"
  | "return_date"
  | "origin"
  | "destination"
  | "transport";

/**
 * 交通ICのフォームの状態モデル。スカラーの平坦なマップ。
 * 候補日程タブとは形が違うので共有しない（共有するのは `FieldSource` だけ）。
 */
export type FormState = Record<
  FieldName,
  { value: string; source: FieldSource }
>;

export const EMPTY_FORM: FormState = {
  departure_date: { value: "", source: "manual" },
  return_date: { value: "", source: "manual" },
  origin: { value: "", source: "manual" },
  destination: { value: "", source: "manual" },
  transport: { value: "", source: "manual" },
};

/**
 * 欄の表示名。JSX・プレビューの一覧・反映の報告の3箇所から引く。
 *
 * 報告（`ApplyReport`）とプレビューに載せる文字列がここから来るので、片方だけ直すと
 * 画面のラベルと「更新: 出発日」の言い方が食い違う。
 */
export const FIELD_LABELS: Record<FieldName, string> = {
  departure_date: "出発日",
  return_date: "帰着日",
  origin: "出発地",
  destination: "目的地",
  transport: "交通手段",
};

export const FIELD_NAMES = Object.keys(FIELD_LABELS) as FieldName[];

export const TRANSPORT_LABELS = {
  train: "鉄道",
  flight: "航空機",
  other: "その他",
} as const;

/**
 * プレビューに出す値（設計書 3.6.1節）。**フォームに入る値ではなく職員が読む文字列。**
 *
 * WHY 分けるか: 交通手段だけは契約の値（`train`）とフォームの値が同じで、職員が読む
 * 語（`鉄道`）が違う。プレビューに `train` と出すと、押す前に確認するという
 * ADR-0006 の目的がその欄だけ果たせない。
 */
function previewValue(
  name: FieldName,
  result: ParseReservationOutput,
): string | null {
  if (name === "transport") {
    const raw = result.transport;
    return raw === null ? null : TRANSPORT_LABELS[raw];
  }
  return result[name];
}

/**
 * AI の結果をプレビューの一覧へ写す（ADR-0006）。
 *
 * **読み取れなかった欄も行として残す**（`value` が `null`）。落とすと、聞き返しの
 * 判断（`previewTone`）が「全部埋まった」と読んでしまい、何が足りないのかも
 * 画面から消える。
 *
 * **いまのフォームを見て、押しても変わらない欄に印を付ける。** 判定は `applyToForm`
 * と同じ条件（手入力かつ空でない）で、この2つが食い違うとプレビューが嘘になる —
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
 * 空にした欄を守らないのは既知の穴（`applyToForm` の但し書き）。空欄は初期状態と
 * 区別が付かないので、次の反映で埋め直される。
 */
function isPreserved(field: FormState[FieldName]): boolean {
  return field.source === "manual" && field.value !== "";
}

/**
 * AI の出力をフォームへ写し、何を更新して何を守ったかを一緒に返す。
 *
 * **手で直した欄は上書きしない**（#38 の判断）。これで AI バッジが「再生成で
 * 上書きされる範囲」の印としても働く。代わりに、追加で指示したのに変わらない欄が
 * 出るので、守ったことを報告に載せて画面から分かるようにする。
 *
 * 既知の穴: 職員が「消す」で空にした AI 由来の欄は `{value: "", source: "manual"}`
 * になるが、空欄は初期状態と区別が付かないので次の再生成で埋め直される。分けるには
 * `FieldSource` に3つ目の状態が必要で、それを足すと3タブすべての印の意味が変わる。
 * 埋め直しは報告の「更新」に出るので、第1段はこのまま進める。
 */
export function applyToForm(
  current: FormState,
  result: ParseReservationOutput,
): { next: FormState; report: ApplyReport } {
  const next = { ...current };
  const updated: string[] = [];
  const preserved: string[] = [];

  for (const name of FIELD_NAMES) {
    const raw = result[name];
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
    // 日付は出力契約が YYYY-MM-DD を保証するので、`<input type="date">` へ
    // そのまま渡せる。整形は要らない。
    next[name] = { value: raw, source: "ai" };
    updated.push(FIELD_LABELS[name]);
  }

  return { next, report: { updated, preserved } };
}
