#!/usr/bin/env python3
"""PreToolUse(Bash) フック: 宣言的ルールで表現できない破壊的操作だけをブロックする。

固定パターン（aws * delete-*、cdk destroy、git push --force など）は
.claude/settings.json の permissions.deny に置いてある。実測で確認した挙動:

  - 前方一致・中間ワイルドカードのどちらも効く
  - 複合コマンド（`a && b`）は分解して評価される
  - `cmd:*` 形式はトークン境界を尊重するため、`--force:*` は `--force-with-lease` を巻き込まない
  - deny は allow に勝つ（allow で例外を作れない）

ここに残すのは、その最後の性質ゆえに宣言できない2件のみ:

  1. rm -rf のアローリスト判定
     「再生成可能なパスだけ許可、それ以外は拒否」は、拒否対象が開集合なので
     列挙できず、deny が allow に勝つため例外も作れない。
  2. --force-with-lease のブランチ判定
     デフォルトブランチ宛てだけ拒否したいが、判断には git の実行時状態が必要。

自作のシェル解析を信頼境界に置くとバグが出る（実際に区切り文字と改行の扱いで
2度の誤検知を出した）。ここを増やす前に、まず permissions.deny で書けないかを検討すること。
変更したら python3 .claude/hooks/tests/test_guard.py で回帰を確認する。
"""

import json
import os
import re
import shlex
import subprocess
import sys

# 再生成可能なため rm -rf を許可するパス名（パスの末尾要素で判定）
REGENERABLE = {
    "node_modules",
    "dist",
    "build",
    "out",
    ".next",
    ".turbo",
    ".cache",
    ".pnpm-store",
    "coverage",
    "temp",
    "tmp",
    "__pycache__",
    ".venv",
    ".pytest_cache",
    ".mypy_cache",
    "cdk.out",
}
REGENERABLE_SUFFIX = (".tsbuildinfo", ".log")

SEPARATORS = {";", "&&", "||", "|", "&"}

# シェルとして解釈できなかった行を fail closed にするかの判定
DESTRUCTIVE_KEYWORDS = re.compile(r"(rm\s+-|--force|(^|\s)-f(\s|$))")


def respond(reason: str) -> None:
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        },
        sys.stdout,
    )
    sys.exit(0)


def git(*args: str) -> str:
    try:
        return subprocess.run(
            ["git", *args], capture_output=True, text=True, timeout=5
        ).stdout.strip()
    except Exception:
        return ""


def default_branch() -> str:
    ref = git("symbolic-ref", "--short", "refs/remotes/origin/HEAD")
    if ref:
        return ref.rsplit("/", 1)[-1]
    for candidate in ("main", "master"):
        if git("rev-parse", "--verify", "--quiet", candidate):
            return candidate
    return "main"


def tokenize(line: str) -> list[str]:
    """シェル的にトークン分解する。

    shlex.split() は `;` や `&&` を直前の語にくっつけたまま返すため（"x;" が1トークンに
    なる）、文の境界を取り違えて「ある文の rm が次の文のトークンまで削除対象として
    吸い込む」誤検知が起きる。punctuation_chars を有効にして区切り文字を独立した
    トークンとして扱う。
    """
    lexer = shlex.shlex(line, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    return list(lexer)


def statements(tokens: list[str]) -> list[list[str]]:
    """トークン列を ; && || | で区切って文単位に分割する。"""
    result: list[list[str]] = [[]]
    for token in tokens:
        if token in SEPARATORS:
            result.append([])
        else:
            result[-1].append(token)
    return [s for s in result if s]


def _is_ephemeral(path: str) -> bool:
    """OS の一時領域配下は、そもそも揮発的なので削除を妨げない。"""
    tmpdir = os.environ.get("TMPDIR", "").rstrip("/")
    prefixes = ["/tmp/", "/private/tmp/", "/var/folders/", "/private/var/folders/"]
    if tmpdir:
        prefixes.append(tmpdir + "/")
    return any(path.startswith(prefix) for prefix in prefixes)


def is_regenerable(path: str) -> bool:
    cleaned = path.rstrip("/")
    if not cleaned or cleaned in {".", ".."}:
        return False
    if _is_ephemeral(cleaned):
        return True
    # 絶対パス・ホーム参照はリポジトリ外を触る可能性があるため許可しない
    if cleaned.startswith(("/", "~")) or "$" in cleaned:
        return False
    if ".." in cleaned.split("/"):
        return False
    tail = cleaned.rsplit("/", 1)[-1]
    return tail in REGENERABLE or tail.endswith(REGENERABLE_SUFFIX)


def check_rm(stmt: list[str]) -> None:
    """(1) 再生成できないパスへの rm -rf を拒否する。"""
    flags = [t for t in stmt[1:] if t.startswith("-")]
    joined = "".join(f.lstrip("-") for f in flags)
    # 再帰でも強制でもない rm（単一ファイル削除）は対象外
    if not any(c in joined for c in "rRf"):
        return
    targets = [t for t in stmt[1:] if not t.startswith("-")]
    if not targets:
        return
    bad = [t for t in targets if not is_regenerable(t)]
    if bad:
        respond(
            "rm -rf の対象に再生成できないパスが含まれるためブロックしました: "
            + ", ".join(bad)
            + "。未コミットの変更が失われる可能性があります。"
            "再生成可能なパス（node_modules, dist, build, coverage, .next 等）以外を消す必要がある場合は、"
            "対象と理由をユーザーに提示して実行を依頼してください。"
        )


def check_force_with_lease(stmt: list[str]) -> None:
    """(2) デフォルトブランチ宛ての --force-with-lease を拒否する。

    素の --force / -f は permissions.deny 側で止まる。--force-with-lease は
    「未取得の commit があれば失敗する」だけで、取得済み履歴の書き換えは防げないため、
    共有ブランチ宛てのみここで止める。
    """
    args = stmt[stmt.index("push") + 1 :]
    if not any(
        a.startswith(("--force-with-lease", "--force-if-includes")) for a in args
    ):
        return

    positionals = [t for t in args if not t.startswith("-")]
    refspec = positionals[1] if len(positionals) >= 2 else ""
    target = refspec.split(":")[-1] if refspec else git("rev-parse", "--abbrev-ref", "HEAD")
    base = default_branch()
    if target and target == base:
        respond(
            f"デフォルトブランチ ({base}) への force push は共有履歴の書き換えになるためブロックしました。"
            "--force-with-lease でも他メンバーが取得済みの履歴は壊れます。"
            "ユーザーに実行を依頼してください。"
        )


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    command = (payload.get("tool_input") or {}).get("command") or ""
    if not command:
        sys.exit(0)

    # shlex は改行をトークンとして残さないため、先に行で分割する。
    # これを怠ると複数行スクリプトが1文として扱われ、ある行の rm が
    # 後続行のトークンまで削除対象として吸い込んでしまう。
    for line in command.splitlines():
        if not line.strip():
            continue
        try:
            tokens = tokenize(line)
        except ValueError:
            if DESTRUCTIVE_KEYWORDS.search(line):
                respond(
                    "コマンドを解釈できず、かつ破壊的な操作を含む可能性があるためブロックしました。"
                    "単純な形に分けて実行するか、ユーザーに実行を依頼してください。"
                )
            continue

        for stmt in statements(tokens):
            if not stmt:
                continue
            head = stmt[0].rsplit("/", 1)[-1]
            if head == "rm":
                check_rm(stmt)
            elif head in {"sudo", "xargs"} and "rm" in stmt:
                check_rm(stmt[stmt.index("rm") :])
            if "git" in stmt and "push" in stmt:
                check_force_with_lease(stmt)

    sys.exit(0)


if __name__ == "__main__":
    main()
