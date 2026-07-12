# ClipKeep for Notion — 公開前チェックリスト

現在のステータス: **ローカルでの公開準備は完了。外部公開（Chromeウェブストアへの申請/提出）はユーザーの
最終承認待ちで停止しています。** 実行済み/未実行の区別と、承認が必要な事項は本ドキュメント末尾にまとめています。

2026-07-11、ユーザーの実機テストで見つかったバグ対応（複数ワークスペース対応・画像抽出修正・
データベース一覧のページネーション・「People」コレクション除外・データベース選択のプルダウン化・
フレンドリーなエラーメッセージ）をコミット（`7d867a0`）し、`npm run typecheck && npm test`が
全てグリーンであることを確認した上で、配布用ZIP（`release/clipkeep-for-notion-1.0.0.zip`、
17ファイル）を最新の`dist/`から再作成しました。同日、ユーザー承認のうえプライバシーポリシーを
既存のpublicリポジトリ`nobu1120/clipkeeper`経由でGitHub Pagesに実際に公開しました
（https://nobu1120.github.io/clipkeeper/privacy-policy.html）。

2026-07-10、コンプラ/法律・シニアエンジニア・Codex CLIの3レビュアーによる外部監査を実施し、
指摘されたブロッカー（Pro/ライセンスキーUIの誤解を招く表示、プライバシーポリシーの内容不足・
未ホスティング、連絡先未確定）およびshould-fix項目（Readabilityのライセンス表記漏れ、
本文抽出時の例外未処理・サニタイズ不足、content script重複注入）はすべて対応済みです。
拡張機能名は「ClipKeep for Notion」のまま維持することで確定し、配布用ZIPも最新コードで
再作成済みです。プライバシーポリシーの実ホスティング（GitHub Pages等）と連絡先メールアドレスの
確定は、ユーザーの明示的な指示によりあえて**保留**しています（内容は完成済みだが、連絡先は
差し替え可能なプレースホルダーのまま。実際の外部公開はまだ承認されていません）。

## 1. 本番ビルド・manifest ✅ 完了

- [x] `manifest_version: 3` / MV3準拠
- [x] バージョンを `1.0.0` に設定（初回公開版として。`package.json`と同期済み）
- [x] 権限を最小化済み: `contextMenus`, `storage`, `activeTab`, `scripting`, `notifications` のみ。
      `host_permissions`は`https://api.notion.com/*`のみで`<all_urls>`は要求していない
      （content scriptは`activeTab`+`scripting`による動的注入のみで、静的な`content_scripts`宣言は無し）
- [x] `description`（58文字）・`name`（19文字）ともにChrome側の文字数制限内
- [x] アイコン16/48/128をmanifestに設定済み（※デザインは仮。下記「残タスク」参照）
- [x] `action.default_title`を追加（ツールバーアイコンのツールチップ）
- [x] CSPは`script-src 'self'; object-src 'self'`のみ。リモートコード実行・evalなし
- [x] `npm run typecheck && npm test` 実行済み・全テストグリーン（`test:logic` / `test:extraction` / `test:ui`）
- [x] 配布用ZIP再作成済み: `release/clipkeep-for-notion-1.0.0.zip`（Pro UI削除・
      `THIRD_PARTY_LICENSES.txt`追加・`extract.ts`修正を反映した最新ビルドから作成。13ファイル、
      パス区切りは`/`で正しくZIP仕様準拠）

## 2. ストア掲載素材 ✅ 完了（内容の最終確認は必要）

- [x] ストア掲載文（短い説明/詳細説明/単一目的説明/カテゴリ）: [`store/LISTING.md`](store/LISTING.md)
- [x] 権限ごとの正当性説明文: [`store/LISTING.md`](store/LISTING.md) 内の表
- [x] スクリーンショット4枚（1280×800、実際にコンパイルされたUIから生成）: `store/screenshots/`
- [x] プライバシーポリシー草案: [`store/PRIVACY_POLICY.md`](store/PRIVACY_POLICY.md)
      （権限ごとの正当性説明を含めて完成。ホスティング用HTML版: [`docs/privacy-policy.html`](docs/privacy-policy.html)）
- [x] 申請手順・審査対策ガイド: [`store/SUBMISSION_GUIDE.md`](store/SUBMISSION_GUIDE.md)

## 3. 残タスク・要判断事項（公開前に決めるべきこと）

### 3-1. 決済連携・OAuthの要否 → **v1では不要と判断（推奨）**

- 現状Proプラン/ライセンスキーは**ローカル検証のみのスタブ**で、実際の決済導線（Stripe等）は未実装
- 決済・サーバーサイドのライセンス検証・Notion Public Integration（OAuth）への移行は、
  「初回リリースをまず無料版として出し、需要を見てから有料化する」方針であれば**v1では不要**
- Notion認証も現状の「Internal Integration Token手動貼り付け」方式のままで初回公開は可能
  （ユーザーがNotion側でトークンを発行する一手間はあるが、機能上は問題なく動作する）
- 決済を先に実装したい場合は、[`SPEC.md`](SPEC.md)の非スコープ項目を参照して別途スコープを組む

### 3-2. Pro/ライセンスキーUIの扱い ✅ 対応済み（(a) UIを削除）

3体のレビュアー（コンプラ/法律・シニアエンジニア・Codex CLI）による外部監査で全員が
blocker級として指摘したため、[`src/options/options.ts`](src/options/options.ts)から
「ライセンスキーを適用」ボタン・入力欄・「Proを解除（開発用）」ボタンを完全に削除しました。
オプション画面は現在、無料プランの残りクリップ数・データベース登録上限のみを表示する、
購入導線が一切ない状態です（無料機能だけで成立する状態）。

- バックエンド側（`src/lib/plan.ts`のロジック、`ACTIVATE_LICENSE`/`DEACTIVATE_LICENSE`
  メッセージハンドラ）はUIから到達不能な内部実装として残しています。将来Stripe等の決済を
  実装する際の土台として利用でき、ユーザーからは見えないため誤認リスクはありません。
- [`scripts/ui-test.mjs`](scripts/ui-test.mjs)を更新し、オプション画面に「ライセンスキー」
  文言や`#license-input`が一切存在しないことを自動テストで確認するようにしました（グリーン確認済み）。
- [`store/LISTING.md`](store/LISTING.md)・[`store/PRIVACY_POLICY.md`](store/PRIVACY_POLICY.md)には
  元々「Proプランは開発中」という記述はありますが、実際にクリックできる購入導線がない現状では
  誤認リスクは低いと判断しています。ストア掲載文からも同種の表現を外すかどうかは、
  申請直前の最終確認事項として残しています。

### 3-3. 拡張機能名の商標リスク ✅ ユーザー承認済み（現状維持）

拡張機能名に「Notion」を含む「ClipKeep **for Notion**」を使用しています。

- 同種の非公式クリッパー（"Save to Notion"等）が実在し、Chrome Web Storeで公開・審査通過している
  前例はあります（一般的に「◯◯ for X」という互換性を表す名称は許容されることが多い）
- 3体のレビュアーとも「許容範囲、ただし100%安全とは言い切れない」と評価
- ユーザーの承認により、名称は現状の「ClipKeep for Notion」のまま維持することで確定しました。
  コード・ドキュメントの変更はありません。

### 3-4. ストアアイコンの品質（法的・審査上の必須事項ではないが推奨）✅ 簡易改善版に差し替え済み

単色の丸だったプレースホルダーを、[`scripts/make-icons.mjs`](scripts/make-icons.mjs)を拡張し、
ブランドカラー（青）の円に白い「C」のリングマークを重ねたアイコンへ変更しました
（16/48/128pxで再生成・`npm run build`で`dist/`へ反映・配布ZIPも再作成済み）。

ただしこれも依然として機械生成の簡易版であり、正式なロゴデザインではありません。
公開前にきちんとしたロゴへ差し替えることは引き続き推奨（必須ではない）です。

### 3-5. プライバシーポリシーのホスティング ✅ 公開済み

[`docs/privacy-policy.html`](docs/privacy-policy.html)は、既存のpublicリポジトリ
`nobu1120/clipkeeper`（`origin`として設定済み）にpushし、リポジトリの`/docs`フォルダを
配信元としてGitHub Pagesを有効化することで、実際に公開しました。

**公開URL: https://nobu1120.github.io/clipkeeper/privacy-policy.html**

ビルド完了・ページ内容（タイトル、連絡先メールアドレス`nobuyoshi1120@gmail.com`）の
正常表示を確認済みです（2026-07-11）。

なお、このリポジトリには拡張機能のソースコード一式もあわせて公開されています
（ユーザー確認・承認済み）。

### 3-6. 連絡先メールアドレスの確定 ✅ 対応済み

ユーザーの指定により、連絡先メールアドレスを`nobuyoshi1120@gmail.com`に確定し、
[`store/PRIVACY_POLICY.md`](store/PRIVACY_POLICY.md) 8節と[`docs/privacy-policy.html`](docs/privacy-policy.html)
の両方に反映しました。このアドレスは実際にホスティング・公開された時点で世界中に公開されます。

### 3-7. Readabilityライブラリのライセンス表記 ✅ 対応済み

`@mozilla/readability`（Apache-2.0ライセンス、著作権表示の同梱が求められる）の著作権表示・
ライセンス全文を[`public/THIRD_PARTY_LICENSES.txt`](public/THIRD_PARTY_LICENSES.txt)として追加しました。
`esbuild.config.mjs`が`public/`を`dist/`へそのままコピーするため、次回`npm run build`以降は
自動的に配布物に含まれます。既存の`release/clipkeep-for-notion-1.0.0.zip`は本対応前に作成された
ものなので、**申請前に`npm run build`→ZIP再作成が必要**です（下記4項参照）。

### 3-8. コードレベルのshould-fix対応 ✅ 対応済み

シニアエンジニアレビューで指摘された、致命的ではないが公開前に直したほうがよい項目に対応しました。

- [`src/content/extract.ts`](src/content/extract.ts): `Readability#parse()`を`try/catch`で保護。
  解析困難なページ（SPAの空DOM・ペイウォール等）で例外が発生しても、技術的なエラーではなく
  既存の「(本文を自動抽出できませんでした)」というフレンドリーな結果を返すようにしました。
- [`src/content/extract.ts`](src/content/extract.ts): 未信頼な抽出後HTML（`article.content`）を
  ライブDOM要素の`innerHTML`に代入する代わりに、`DOMParser`でパースするよう変更。`DOMParser`の
  出力仕様上、サブリソースの読み込みやスクリプト/イベントハンドラは一切実行されないため、
  XSS隣接リスクを構造的に排除しています。
- [`src/content/index.ts`](src/content/index.ts): 同一タブでの`content.js`重複注入時に
  `chrome.runtime.onMessage`リスナーが積み上がらないよう、グローバルフラグによるガードを追加しました。

### 3-9. 実ブラウザQA・再レビューで発見した追加バグ ✅ 対応済み

上記のshould-fix対応後、実際のChrome上でライブサイトを操作するQAサブエージェントと、
コードを再レビューするシニアエンジニアサブエージェントの2体を並行実行し、追加で以下を発見・修正しました。

- **（重大・修正済み）`src/content/extract.ts`のブロック変換ロジックが`<main>`タグ等の
  未知のコンテナ要素を再帰せず、サブツリー全体を1つの巨大な段落ブロックに潰していた**問題。
  実際のライブページ（developer.chrome.com、CSS-Tricksの記事等）で検証したところ、見出し・
  リスト・コードブロック・画像がすべて失われ、記事全体が1ブロックの平文になってしまうことを
  QAサブエージェントが実機検証で発見しました。`<main>`を既知のコンテナタグに追加し、さらに
  未知のタグでも子要素を持つ場合は再帰するようフォールバックを一般化しました。
  [`scripts/fixtures/sample-article.html`](scripts/fixtures/sample-article.html)を
  `<article>`から`<main>`ラップに変更し、[`scripts/extraction-test.mjs`](scripts/extraction-test.mjs)
  に回帰防止アサーションを追加済みです（テストグリーン確認済み）。
- **（軽微・修正済み）`src/lib/notion.ts`の`testConnection()`が、三項演算子の両分岐が同一の
  ため常に`data.name`（インテグレーション名）を返し、実際のワークスペース名
  （`data.bot.workspace_name`）を一度も使っていなかった**問題。オプション画面の接続表示名が
  実際のワークスペース名と異なって見える表示バグを修正しました。
- DOMParser化（3-8）による相対画像URLの破損リスクは、シニアエンジニアレビューとQAサブエージェントの
  両方が実ページで検証し、**回帰なし**と確認済みです（Readabilityが`article.content`を返す前に
  相対URLを絶対URLへ解決済みのため）。
- 実ブラウザQAでは、この開発環境の組織ポリシーによりDeveloper Modeでの拡張機能読み込みが
  引き続きブロックされていることを再確認しました（`npm run smoke`・GUI操作どちらも不可）。
  そのため無効トークン時のエラー表示・右クリックコンテキストメニューの実機確認は今回も
  未実施です。ユーザーの手元のPCなど制約のない環境での最終確認を推奨します。
- 追加で軽微な指摘（クリップ数上限チェックの非原子性、未使用の`isDefaultForDomains`フィールド、
  未使用の`extractPlainTitle`関数）がありましたが、いずれもnice-to-have〜低リスクのshould-fixで
  あり、公開のブロッカーではないため一旦見送っていました。**2026-07-11〜12にすべて対応済み**
  （[3-11](#3-11-2026-07-11-12-の追加対応)参照）。

### 3-10. ユーザー実機テストで発見された2件のバグ ✅ 対応済み

ユーザーが実際にご自身のPCで`dist/`を読み込んでの動作確認中に発見した2件を修正しました。

- **（重大・修正済み）画像が抽出できない**: [src/content/extract.ts](src/content/extract.ts)の画像抽出が
  `<img src>`が`http`で始まる場合のみを対象としていたため、多くの実サイトが採用する遅延読み込み
  （実URLを`data-src`等に隠し、`src`には読み込み完了まで1x1のダミー画像を仕込む方式）に対応できて
  いませんでした。Readability自身にも同様の補正機能はありますが、`.jpg/.jpeg/.png/.webp`の拡張子
  パターンにしか対応しておらず、拡張子なし・クエリパラメータ付きの実URL（多くのCDNで一般的）を
  取りこぼします。`data-src`/`data-lazy-src`/`data-original`/`srcset`等を横断的にチェックし、
  base64プレースホルダーは除外して実URLへ解決するよう`resolveImageUrl()`を追加しました。
  回帰防止テストを[scripts/fixtures/sample-article.html](scripts/fixtures/sample-article.html)・
  [scripts/extraction-test.mjs](scripts/extraction-test.mjs)に追加済みです。
- **（重大・修正済み）データベース接続時にワークスペース／アカウントを選べない**: これはUIの不具合
  ではなく、そもそも複数ワークスペースを扱う仕組みが存在しない設計上の制約でした。Internal
  Integration Tokenは1トークン=1ワークスペースに紐づく認証方式のため、単一の接続情報しか保存しない
  従来の設計では、2つ目以降のワークスペースを追加する手段自体がありませんでした。以下の対応で、
  複数のNotionワークスペース（アカウント）を接続し、切り替えて使えるようにしました。
  - [src/lib/types.ts](src/lib/types.ts)・[src/lib/storage.ts](src/lib/storage.ts): 単一の接続情報を
    `NotionConnection[]`（複数ワークスペースのリスト）＋アクティブなワークスペースIDという構造に変更
  - [src/background/index.ts](src/background/index.ts): `ADD_CONNECTION`/`REMOVE_CONNECTION`/
    `SET_ACTIVE_CONNECTION`/`GET_CONNECTIONS`メッセージを追加。登録済みデータベースも
    `connectionId`でワークスペースごとにスコープし、ワークスペースを切り替えると保存先データベース
    一覧も正しく切り替わるようにしました（無料プランのクリップ数・DB登録上限は従来通り全ワークスペース
    横断でのカウントとし、ここを迂回した無料枠拡大はできないようにしています）
  - [src/options/options.ts](src/options/options.ts): 接続中のワークスペース一覧・「これに切り替え」
    ・個別の「解除」ボタンを表示するUIに変更
  - `popup.ts`は`GET_CONNECTION`（アクティブなワークスペースの情報を返す後方互換の形）をそのまま
    使えるため変更不要です
  - [scripts/logic-test.mjs](scripts/logic-test.mjs)・[scripts/ui-test.mjs](scripts/ui-test.mjs)に
    2ワークスペースの追加・切り替え・データベースのスコープ分離・削除の一連のフローを検証する
    テストを追加し、グリーンであることを確認済みです
  - 注: これはOAuthではなく、引き続き手動トークン貼り付け方式の範囲内での対応です。Notion公式の
    ような「ログイン時にワークスペースを選ぶ」体験そのもの（OAuth化）は、README記載の通り自前
    サーバーが必要な将来スコープのままです

### 3-11. 2026-07-11〜12 の追加対応

- **クリップ数上限チェックの非原子性を修正**: [`src/lib/plan.ts`](src/lib/plan.ts)の
  `checkClipQuota()`（チェックのみ）と保存成功後の`incrementUsage()`が別々のタイミングで
  実行されていたため、右クリック保存とポップアップ保存がほぼ同時に実行されると、両方が
  同じ「残り1件」を読んでしまい上限を超えて保存できる競合状態がありました。チェックと加算を
  `reserveClipQuota()`として1つのロック付きアトミック操作にまとめ、保存が失敗した場合は
  `releaseClipQuota()`で予約を解放するように変更しました。[`scripts/logic-test.mjs`](scripts/logic-test.mjs)
  に、同時保存で上限を超えないこと・失敗時に枠が正しく解放されることを検証する回帰テストを追加済みです。
- **未使用コードの削除**: `RegisteredDatabase`の未使用フィールド`isDefaultForDomains`、
  `src/lib/notion.ts`の未使用関数`extractPlainTitle()`を削除しました。
- **ストアアイコンを簡易改善版に差し替え**: 単色の丸だったプレースホルダーを、ブランドカラー
  （青）の円に白い「C」のリングマークを重ねたものに変更しました（[`scripts/make-icons.mjs`](scripts/make-icons.mjs)）。
  依然として機械生成の簡易版であり、正式なロゴデザインではありません。
- **ポータル/アグリゲーターページでの抽出品質を改善**: ユーザー報告を受け、Yahoo! JAPANの
  トップページを実際にブラウザ自動化で取得・検証したところ、`extractFullPage()`自体はクラッシュや
  ハングもなく正常終了する一方（約100ms）、抽出結果100ブロック中87個がナビゲーションメニュー
  （「ホームページに設定する」「きっず版」「ヘルプ」等）になってしまい、実質的な本文がほぼ
  含まれていないことを確認しました。原因は、Readabilityの候補スコアリングがclass/id名の
  キーワード一致（"nav"/"menu"等）に依存しているところ、実サイトの難読化・ハッシュ化された
  class名ではそのヒューリスティックが機能せず、かつポータルページには「単一の記事」自体が
  存在しないため、サイト全体のヘッダーナビゲーションが本文として選ばれてしまうことでした。
  [`src/content/extract.ts`](src/content/extract.ts)に`stripPageChrome()`を追加し、
  `<article>`/`<main>`の外側にある`header`/`nav`/`footer`/`aside`および対応するARIA
  ランドマーク（`role="navigation"`等）をReadabilityへ渡す前に除去するようにしました
  （記事内部の`<header>`等、`<article>`/`<main>`の内側にあるものは本文の一部として保持）。
  修正後、同じYahoo! JAPANトップページで再検証したところ、ナビゲーション項目は一切含まれず、
  代わりに実際のニュース見出し（「九州 40℃に迫る危険な暑さ予想」等）が抽出されることを
  実機で確認しました。[`scripts/fixtures/sample-article.html`](scripts/fixtures/sample-article.html)・
  [`scripts/extraction-test.mjs`](scripts/extraction-test.mjs)に、この実バグを再現する
  回帰テスト（`<main>`の外にリンクだらけの`<header>`を配置し、その項目が抽出結果に含まれない
  ことを検証）を追加済みです。
  - 注: これはヒューリスティックによる改善であり完全な解決ではありません。`<main>`/`<article>`の
    外側にchromeが無い、または本文自体が非常にリンク密度の高い構造のポータルページでは、
    引き続き理想的な抽出ができない可能性があります。

## 4. 承認事項（外部公開の直前で停止中）

3体のレビュアーによる外部監査（2026-07-10実施）で指摘されたブロッカーのうち、コード修正で
対応可能なもの（Pro UI削除・プライバシーポリシー内容整備・連絡先メールアドレス確定・
ホスティング用HTML準備・should-fix・ZIP再作成）はすべて対応済みです。拡張機能名は現状維持で
確定しました。プライバシーポリシーの実ホスティングもユーザー承認のうえ完了しました（[3-5](#3-5-プライバシーポリシーのホスティング-公開済み)）。
残るのは以下の通り、**このリポジトリの外側で行う実際の公開・提出アクション**のみです
（ユーザーの指示により意図的に保留中）。

1. **Chrome Web Store Developer Dashboardへの登録・$5登録料の支払い、および実際の審査提出**（保留中）
   - Googleアカウントでの支払い・申請は開発者ご本人が行う必要があります
     （[`store/SUBMISSION_GUIDE.md`](store/SUBMISSION_GUIDE.md)に手順を記載済み）
   - 実際に「申請してよい」というご承認をいただいた時点で、ストア掲載情報の最終セットをこちらで整えます

上記は明確なご承認のもとで着手し、
最終的な申請作業（Developer Dashboardへのログイン・アップロード・審査提出）はご自身で
行っていただきます。
