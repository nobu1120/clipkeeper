# ClipKeep for Notion — 仕様書 / 実装計画

対象課題: [[SELECTION.md]] の通り、Notion公式Web Clipper（および人気代替）の
「保存が不安定・失敗が分かりにくい」「クリップ時にタグ/プロパティを設定できない」を解消する。

## プロダクト名（仮）
**ClipKeep** — Notionへ確実に、タグ付けして保存できるクリッパー

## ターゲットユーザー
- Notionで情報収集・ナレッジ管理をしている個人（リサーチャー、学生、マーケター、個人開発者）
- 複数のNotion DBを使い分けて記事/資料/リンク集を整理したい人

## MVPスコープ（v0.1）

### 機能
1. **ページ全体クリップ**
   - ツールバーアイコン or 右クリックメニューから起動
   - content scriptが本文を抽出（Readability方式）し、タイトル・本文（見出し/段落/リスト/画像/コードブロック/引用に変換）・元URL・OGP画像を取得
   - 保存先Notionデータベースをポップアップで選択
   - 保存前にプロパティ（タイトル編集、タグ/複数選択、任意のSelectプロパティ）をその場で設定できる（＝代替ツールが弱い「クリップ時にタグ付けできない」を解消）
   - 保存結果を明確にポップアップ内に表示（成功/失敗・失敗理由・失敗時は再試行ボタン）＝「静かに失敗する」問題を解消

2. **選択範囲クリップ**
   - ページ上でテキストを選択→右クリック→「ClipKeepで保存」
   - 選択テキストを引用ブロックとして新規ページ、または既存ページに追記

3. **接続設定（オプションページ）**
   - Notion Internal Integration Token を貼り付けて接続確認
   - 保存先候補データベース一覧を取得・お気に入り登録
   - 使用量（今月のクリップ数 / 上限）を表示

4. **フリーミアム制御**
   - 無料プラン: 月20クリップまで、接続DBは1つまで、プロパティ編集は簡易（タイトルのみ）
   - Proプラン（想定 ¥500/月 または ¥4,800/年）: クリップ数無制限、DB複数登録・ドメインごとの既定DB自動選択、プロパティ全項目編集、テンプレート（保存時に決まったプロパティ雛形を適用）
   - 本セッションのMVPでは「ライセンスキー入力→ローカル検証で解放」のスタブを実装し、将来Stripe等の決済+ライセンスサーバーに差し替えられる設計にする（実際の決済は範囲外）

### 非スコープ（v0.1では実装しない。将来拡張として設計だけ空けておく）
- 完全なOAuth（Notionのpublic integration + 自前サーバー）— v0.1はInternal Integration Tokenで代替
- 実際の課金導線（Stripe Checkout等）
- PDF/動画/複雑な埋め込みの完全対応
- AIによる自動タグ提案

## 技術仕様
- **Manifest V3 / TypeScript**
- ビルド: esbuild（軽量・高速、拡張機能開発で定番）
- 構成:
  - `src/background.ts`: service worker。右クリックメニュー登録、Notion API呼び出し（DB一覧取得・ページ作成）、使用量カウント管理
  - `src/content/extract.ts`: content script。ページ本文抽出（@mozilla/readability使用）、選択テキスト取得
  - `src/popup/`: クリップ実行UI（DB選択・プロパティ編集・保存結果表示）
  - `src/options/`: 接続設定・DB管理・プラン管理
  - `src/lib/notion.ts`: Notion API薄いクライアント（fetchラッパー）
  - `src/lib/usage.ts`: 無料枠カウント・Pro判定ロジック
  - `src/lib/storage.ts`: chrome.storage.local/sync ラッパー
- 権限（manifest permissions）: `contextMenus`, `storage`, `activeTab`, `scripting`, ホスト権限は `https://api.notion.com/*` のみ（任意サイトの本文取得はactiveTab + content scriptで最小権限に留める）

## データフロー
1. ユーザーがツールバー/右クリックでクリップ開始
2. background → content script に `EXTRACT_CONTENT` メッセージ送信
3. content scriptがReadabilityで本文抽出しレスポンス
4. popupがDB一覧（background経由でNotion APIをキャッシュ取得）を表示、ユーザーがDB・プロパティを選択
5. popup → background に `SAVE_CLIP` メッセージ、background が使用量チェック→Notion API `POST /v1/pages` 実行
6. 結果をpopupに返し、成功/失敗を明示表示。成功時は使用量カウントを+1

## 実装計画（本セッションで実施）
1. プロジェクト雛形（npm, tsconfig, esbuild, manifest.json, ディレクトリ）
2. lib/storage, lib/usage, lib/notion を実装
3. background.ts（メッセージハンドラ、右クリックメニュー、Notion API呼び出し）
4. content/extract.ts（Readabilityベースの本文抽出、選択テキスト抽出）
5. popup（HTML+TS、DB/プロパティ選択、保存実行、結果表示、使用量表示）
6. options（HTML+TS、トークン接続、DB一覧管理、ライセンススタブ）
7. アイコン・manifest最終調整
8. ビルド → puppeteer-core + 実Chromeで拡張を読み込み、manifest/service workerエラーがないこと、popup/optionsが描画されること、ダミーHTMLページに対しcontent scriptの抽出ロジックが動作することを自動テストで確認
9. README.md に開発者向けセットアップ手順（Notion Integration作成方法含む）を記載
