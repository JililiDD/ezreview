<p align="center">
  <img src="../assets/favicon.svg" alt="EZREVIEW logo" width="112">
</p>

<h1 align="center">EZREVIEW</h1>

<p align="center">
  AIPilot と組み合わせてもスタンドアロン能力でも、ブラウザ上で AI 生成の HTML をリアルタイムレビュー。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ezreview"><img src="https://img.shields.io/npm/v/ezreview" alt="npm version"></a>
  <a href="../LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933" alt="Node.js 20 以降">
</p>

<p align="center">
  <a href="../README.md">English</a> | <a href="./README.zh-CN.md">简体中文</a> | <b>日本語</b> | <a href="./README.es.md">Español</a>
</p>

`ezreview` は、AI 開発ワークフロープラグイン [AIPilot](https://github.com/JililiDD/aipilot) 向けのブラウザレビュー用コンパニオンツールです（他の任意の AI エージェントとも併用可能です）。AI が生成したページ上に直接インラインコメントを残し、構造化されたフィードバックをエージェントに送信することで、ソースコード内の正確な場所を特定して修正させることができます。

また、ローカルの HTML ファイルに対するスタンドアロンのコマンドラインインターフェース（CLI）としても機能します。レビューサーバーはローカルマシン上で動作し、`127.0.0.1:4400` にバインドされます。

## デモ

https://github.com/user-attachments/assets/f0a7700b-70dd-41da-8b16-f2aa0bdc6f56

## 主な機能

- **ピンポイントで問題を指摘**: レンダリングされたページ上の DOM エレメントをクリック、またはテキスト範囲を選択
- **アクション可能なコンテキストを送信**: 各アノテーションには、一意の ID、CSS セレクター、関連する HTML、周囲の文脈付き選択テキストが含まれます
- **編集と回答を単一ループで完結**: エージェントは修正リクエストに応じてソースコードを編集し、質問に直接回答できます
- **マルチラウンドの対話をサポート**: 各アノテーションスレッドで複数回のやり取りが可能
- **安全な再開メカニズム**: キューに入れられたフィードバックとアノテーション ID は、コマンドのタイムアウトやサーバーの再起動後も保持されます
- **ローカルデータのプライバシー保護**: サーバーは `127.0.0.1` のみでリッスンします

## EZREVIEW のインストール

[Node.js](https://nodejs.org/) 20 以降をインストールし、`ezreview` をグローバルにインストールします：

```bash
npm install --global ezreview
```

インストールを確認します：

```bash
ezreview --help
```

グローバルインストールを行わずに特定のバージョンを直接実行することもできます：

```bash
npx -y ezreview@latest your_file.html
```

## エージェントにスタンドアロンレビューを実行させるプロンプト

AIPilot は継続的なレビューサイクルを自動的に管理します。AIPilot **なし**で `ezreview` を使用する場合は、セッションをアクティブに保ち、各フィードバックバッチの後に待機するようエージェントに指示してください。

以下のプロンプトをコピーし、`your_file.html` をレビュー対象のファイル名に置き換えて使用してください：

```text
Open your_file.html with ezreview. Use your managed background-task mechanism
to keep the review server running, and keep each ezreview wait attached to the
current execution. Continuously wait for submitted comments. For every comment,
decide whether it requests a change or asks a question. Apply the requested
change or answer the question, reply through ezreview for every annotation ID,
then continue waiting for more feedback. Do not treat a command timeout, empty
output, file reload, or completed feedback batch as review completion. Do not
exit until I click Approve in ezreview or explicitly confirm in chat that the
review is complete.
```

## CLI リファレンス

### レビューセッションの開始

```bash
ezreview your_file.html
```

ローカルレビューサーバーを起動し、ブラウザで HTML ファイルを開き、セッション実行中はアクティブ状態を維持します。同じファイルに対して再度実行すると、新規サーバーを立ち上げる代わりに既存のセッション URL を返します。

### フィードバックの待機

```bash
ezreview wait your_file.html
```

レビュー意図（フィードバックバッチ）が送信されるまでブロックします（キューに未処理のフィードバックがある場合は即座に返します）。各バッチには構造化された修正リクエスト、質問、またはその両方が含まれます。タイムアウト等で中断された場合は、再度実行すれば永続キューから未消費のバッチが返されます。

### アノテーションへの返信

```bash
ezreview reply your_file.html --to a-1 "見出しのサイズを修正しました。"
```

`wait` から返された ID を指定して、特定のアノテーションスレッドに返信を送信します。修正リクエストの場合は、返信する前にソースファイルを保存してください。ブラウザが自動リロードされ、該当するアノテーション内に返信が表示されます。

改行コード（`\n`）を含む複数行の返信を送信する場合は、`--decode-newlines` を追加します：

```bash
ezreview reply your_file.html --to a-1 --decode-newlines "最初の段落\n\n次の段落"
```

ブラウザ上で実際の改行と段落間隔が保持されます。このデコード機能はオプトインであるため、リテラルの `\n` を含むコード例などはデフォルトで影響を受けません。

## エージェントレビューサイクルの規約

AI エージェントは、`ezreview wait` を `&` や `nohup`、`disown` などでバックグラウンドに切り離さず、標準のフォアグラウンド/ブロッキングコマンドとして実行する必要があります。これにより、エージェントはフィードバックが届くまで待機し、結果を即座に処理できます。

各フィードバックバッチに対して、エージェントは以下の手順を実行する必要があります：

1. `ezreview wait` から返されたすべてのアノテーションを読み込む
2. 修正リクエストに応じてソースコードを編集する
3. 質問に対して回答する（修正を示唆していない限りファイルは変更しない）
4. 各アノテーション ID に対して `ezreview reply` を 1 回ずつ実行する
5. 再びフォアグラウンドで `ezreview wait` を開始する
6. ユーザーが画面上で **Approve** をクリックするか、チャットで終了を確認するまで繰り返す

## AIPilot と共に EZREVIEW を使用する理由

[AIPilot](https://github.com/JililiDD/aipilot) は、構造化された Markdown ドキュメントを通じて AI 開発ワークフローを推進します。`ezreview` はインタラクティブなブラウザフィードバックループを提供し、レンダリングされた UI プレビューやデザインドキュメントをリアルタイムでレビューできるようにします。

```text
AIPilot がドキュメントまたはデザインプレビューを生成
                  ↓
EZREVIEW がブラウザでプレビューを開く
                  ↓
ユーザーが要素をアノテートまたはテキストを選択
                  ↓
エージェントが構造化されたフィードバックを受信
                  ↓
エージェントが修正または回答し、EZREVIEW が結果をリロード
```

スクリーンショットの送信、レイアウト位置の手動説明、チャットへの DOM フラグメントの貼り付けはもう不要です。`ezreview` は AIPilot が生成した HTML プレビュー上にコメントを直接アンカーするため、エージェントは正確な要素・テキスト参照に基づいて作業できます。

## 関連プロジェクト

- [AIPilot](https://github.com/JililiDD/aipilot): `ezreview` をブラウザレビューに採用しているドキュメント駆動型 AI 開発ワークフロー
- [lavish-axi](https://github.com/kunchenguid/lavish-axi): `ezreview` の着想の元となったプロジェクト
