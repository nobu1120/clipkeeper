# ClipKeep for Notion (MVP)

Notionへ確実に、タグ付けして保存できるWebクリッパー。選定理由は[`SELECTION.md`](./SELECTION.md)、
仕様・実装計画は[`SPEC.md`](./SPEC.md)を参照。

## セットアップ

```bash
npm install
npm run build      # dist/ に拡張機能一式を出力
```

### Chromeへの読み込み（Developer Mode必須）

1. `chrome://extensions` を開く
2. 右上の「デベロッパー モード」をON
3. 「パッケージ化されていない拡張機能を読み込む」→ このリポジトリの `dist/` を選択

> **注意**: 組織管理のGoogleアカウントがサインインされているChromeプロファイルでは、ポリシーで
> 「デベロッパー モード」自体が無効化されている場合があります（本開発環境で実際に発生し、
> サインインしていない別プロファイルに切り替えることで解決しました）。`chrome://management` で
> 「このブラウザは会社/学校によって管理されています」と出る場合は、管理外の新しいプロフィールを
> 作成して試してください。

### Notion側の準備（MVPの認証方式）

1. https://www.notion.so/my-integrations で新規インテグレーションを作成し、Internal Integration Secretをコピー
2. 保存したいNotionデータベースのページ右上「•••」→「Connections」からそのインテグレーションを接続
3. 拡張機能のオプション画面でSecretを貼り付けて「接続する」

## 開発コマンド

| コマンド | 内容 |
|---|---|
| `npm run build` | 本番用ビルド（`dist/`） |
| `npm run watch` | ウォッチビルド |
| `npm run typecheck` | 型チェックのみ |
| `npm test` | ビルド＋自動テスト一式（下記参照） |
| `npm run smoke` | 実Chromeへの拡張機能読み込みテスト（Developer Mode必須・環境依存） |

## 動作確認について（重要な制約）

この開発環境のChromeは組織ポリシーで「デベロッパー モード」自体が無効化されており、
`--load-extension` によるアンパック済み拡張機能の読み込みができませんでした
（`chrome://extensions` に「この設定は管理者によって管理されています」と表示される）。

これは拡張機能側の不具合ではなく、この端末のChromeプロファイル固有の制約です。そのため本セッションでは、
実際にビルドされたコードを**Developer Modeなしで検証できる3種類の自動テスト**を用意し、すべてグリーンであることを確認しました。

- `npm run test:logic`（`scripts/logic-test.mjs`）
  実際にコンパイルされたbackgroundのメッセージハンドラ（`handleMessage`）をNode上で直接実行し、
  `chrome.storage`/`fetch`をスタブして検証。Notion接続（成功/失敗）、データベース登録の無料枠上限（1件）、
  クリップ保存時のNotion API呼び出し内容（`parent.database_id`、Sourceブロックなど）、月20クリップの無料枠上限と
  ライセンスキーによるPro解放までを実データフローで確認。
- `npm run test:extraction`（`scripts/extraction-test.mjs`）
  実際のReadabilityベース抽出ロジック（`src/content/extract.ts`）を、通常のChromeページ（拡張機能読み込み不要）上で
  サンプル記事に対して実行し、見出し・段落・リスト・引用・コードブロックへの変換とnav/footerの除外を確認。
- `npm run test:ui`（`scripts/ui-test.mjs`）
  実際の`popup.html`/`options.html`をローカルサーバー経由で開き、`chrome.runtime.sendMessage`をモックして
  「未接続→接続」「DB未登録→登録（無料枠上限あり）」「抽出→タグ選択→保存→成功表示」の一連のUIフローを実操作で確認。

これらは「実際にビルドされたコード」を対象にした実行時テストであり、型チェックだけでは検出できない
実行時のロジック不整合・DOM操作ミス・メッセージ受け渡しの不備を検出できます。ただし、
実ブラウザの拡張機能サンドボックス（`chrome-extension://`オリジン、`activeTab`権限、
実際のcontext menuクリック等）を通した最終確認ではないため、**Developer Modeが使える環境での
実機確認を推奨**します（`npm run smoke` が使えます）。

## デモ動画

```bash
npm run build
node scripts/demo/record-demo.mjs   # scripts/demo/clipkeep-demo.mp4 を生成（約1分・gitignore対象）
```

Notion接続→クリップ→タグ選択→保存成功→Notion側の結果、という主要フローを約1分のMP4にまとめたものを
`scripts/demo/record-demo.mjs` で生成できます。実際にコンパイルされたpopup/options/抽出コードを、
`test:ui`と同じ「ローカルサーバー配信＋`chrome.runtime`モック」方式で動かして撮影しています。

- 自動化(CDP)経由でのChrome拡張機能の実読み込みは、上記のDeveloper Mode制約により本環境では安定しないため、
  ブラウザのツールバー/拡張機能アイコン部分は疑似的に描画したオーバーレイです（実際のポップアップHTML/JS自体は本物）。
- 最後の「Notion側に保存された結果」の画面は、実Notionアカウント・実APIを使わないデモ用の静的モックページです
  （ダミーデータでの動作確認という今回の指示に沿ったものです）。

## 既知の制約・今後の拡張ポイント

- 認証はMVPとして「Internal Integration Token」方式。将来的にはNotion Public Integration（OAuth）+
  自前サーバーへ移行し、一般ユーザーがトークンを手動発行しなくても使えるようにする。
- Pro化のライセンスキーはローカル検証のみのスタブ（`src/lib/plan.ts`参照）。実運用前にStripe等の決済と
  サーバーサイド検証に置き換える必要がある。
- 画像・PDF・複雑な埋め込みは簡易対応のみ。
