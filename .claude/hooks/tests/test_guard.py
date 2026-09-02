#!/usr/bin/env python3
"""guard-destructive-command.py の回帰テスト。

検証するのは自作コードの判定だけ:
  hook_deny : 拒否すべきコマンドを拒否すること
  safe      : 通すべきコマンドを通すこと（誤検知はそれ自体が事故で、実際に2度発生した）

.claude/settings.json の permissions が担当する分は検証しない。権限パターンの解釈を
テスト側で再実装すると、本物の評価器とずれた時に偽の安心を与えるため。
委譲先は cases.json の $delegated に記録してある。

実行: python3 .claude/hooks/tests/test_guard.py
"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).parent
GUARD = HERE.parent / "guard-destructive-command.py"
CASES = json.loads((HERE / "cases.json").read_text())


def hook_decision(command: str) -> str:
    payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": command}})
    out = subprocess.run(
        [sys.executable, str(GUARD)], input=payload, capture_output=True, text=True
    ).stdout.strip()
    if not out:
        return "allow"
    return json.loads(out)["hookSpecificOutput"]["permissionDecision"]


def main() -> int:
    failures: list[str] = []
    total = 0

    for group, expected in (("hook_deny", "deny"), ("safe", "allow")):
        print(f"--- {group}（期待: {expected}） ---")
        for command in CASES[group]:
            total += 1
            actual = hook_decision(command)
            ok = actual == expected
            if not ok:
                failures.append(f"{group}: {command!r} -> {actual}（期待 {expected}）")
            print(f"{'ok  ' if ok else 'FAIL'} [{actual:5}] {command}")
        print()

    if failures:
        print(f"{len(failures)} 件の失敗:")
        for line in failures:
            print(f"  {line}")
        return 1
    print(f"{total}/{total} 期待通り")
    return 0


if __name__ == "__main__":
    sys.exit(main())
