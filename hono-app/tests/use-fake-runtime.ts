import { beforeEach } from 'vitest'
import { FAKE_RUNTIME_CLIENT_NAME } from '../src/config.js'
import { fakeRuntimeScript } from '../src/lib/fake-runtime.js'

/**
 * テストは必ず fake の Runtime クライアントで回す（#23 の決定性の確保）。
 *
 * WHY: 開発機の `FORMECHO_RUNTIME_CLIENT` を尊重せず上書きする。尊重すると、その
 * 環境変数を立てた端末でだけテストが実物の Runtime を叩き、立っていなければ
 * RUNTIME_UNAVAILABLE で全部落ちる。実物に繋ぐのは実測の役目で、そちらは設定を
 * 明示して別に走らせる。
 */
process.env.FORMECHO_RUNTIME_CLIENT = FAKE_RUNTIME_CLIENT_NAME

// 台本と記録はモジュール変数なので、テストを跨いで持ち越さない。
beforeEach(() => {
  fakeRuntimeScript.reset()
})
