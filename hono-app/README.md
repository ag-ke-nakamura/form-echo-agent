依存インストール:
```sh
pnpm install
```

起動:
```sh
pnpm run dev
```

http://localhost:3000 を開く

`dev` の中身は Bun（`bun run --hot`）だが、依存管理は pnpm。`bun install` は使わないこと
（`pnpm-lock.yaml` を無視して `bun.lock` を作ってしまう）。
