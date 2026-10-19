# タスク（自分用タスクツール）セットアップ手順

全部で4ステップ、30分ほどです。費用はかかりません。

## ファイル一覧

| ファイル | 役割 |
| --- | --- |
| index.html / app.js / logic.js / sw.js / manifest.webmanifest / icon-*.png | Web版本体（触らなくてOK） |
| config.js | Supabaseの接続情報を書くファイル（ここだけ編集） |
| supabase.sql | データベースを作るSQL |
| widget.js | iPhoneウィジェット（Scriptable用） |

まず試したいだけなら、index.html をそのまま開くと「デモモード」で動きます（データはそのブラウザだけに保存）。

---

## 1. Supabaseの準備

1. https://supabase.com でアカウントを作り、「New project」を作る
   - Region は「Northeast Asia (Tokyo)」がおすすめ
   - Database Password は自分で決めて控えておく（アプリでは使いません）
2. 左メニュー「SQL Editor」→ `supabase.sql` の中身を全部貼り付けて「Run」
   - 「Success」と出ればOK
3. ログインするユーザーを作る
   - 左メニュー「Authentication」→「Users」→「Add user」→「Create new user」
   - メールアドレスとパスワードを入力し、「Auto Confirm User」にチェックして作成
4. 他の人が登録できないようにする
   - 「Authentication」→「Sign In / Providers」で「Allow new users to sign up」をオフにして保存
5. 接続情報を控える
   - 「Project Settings」→「Data API」で Project URL
   - 「Project Settings」→「API Keys」で Publishable key（`sb_publishable_...`、なければ anon key）

※ 画面の名前は変わることがあります。見当たらなければ近い名前のメニューを探してください。

## 2. config.js を編集

```js
window.TASK_CONFIG = {
  SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
  SUPABASE_KEY: 'sb_publishable_xxxxxxxx',
};
```

Publishable key は公開しても大丈夫なキーです。データは「ログインした本人だけ読み書きできる」設定（RLS）で守られています。

## 3. GitHub Pagesで公開

1. GitHubで新しいリポジトリを作る（例: `tasktool`、Public）
2. 「Add file」→「Upload files」で、このフォルダのファイルを全部アップロード
3. リポジトリの「Settings」→「Pages」→ Branch を `main` / `/ (root)` にして「Save」
4. 数分後、`https://（ユーザー名）.github.io/tasktool/` で開けるようになる

### 各端末で使う
- **PC（Windows / Mac）**：上のURLをブラウザで開いてログイン。ブックマーク推奨
- **iPhone**：SafariでURLを開く →「共有」→「ホーム画面に追加」→ アイコンから開いてログイン

## 4. iPhoneウィジェット

1. App Storeで「Scriptable」をインストール
2. Scriptableで「＋」→ `widget.js` の中身を全部貼り付け
3. 冒頭の3行を設定
   - `SUPABASE_URL` と `SUPABASE_KEY`：config.js と同じ
   - `APP_URL`：手順3で公開したURL（ウィジェットをタップしたときに開く）
4. 右下の ▶ で1回実行 → メールアドレスとパスワードでログイン → 今日のタスクが表示されればOK
5. ホーム画面を長押し →「＋」→ Scriptable → 中か大のウィジェットを追加
6. ウィジェットを長押し →「ウィジェットを編集」→ Script で今のスクリプトを選ぶ

ウィジェットの更新タイミングはiOSが決めます（目安 15分〜数時間）。通信できないときは前回のデータを表示します。

---

## 使い方メモ

- **今日**：期限切れ・今日締め切り・やる日が今日以前・手動で入れたタスクが出ます
- **今日へ / 外す**：他の画面の「今日へ」で手動追加、「今日」画面の「外す」で外せます。手動で入れたものは終わるまで翌日以降も残ります
- **完了**：丸をタップ。5秒間は「元に戻す」で取り消せます
- **繰り返し**：完了すると次の回が自動でできます（毎日・毎週・毎週曜日指定・毎月）
- **ジャンル**：「設定」で名前・色・順番を変更、追加、削除できます

## 困ったとき

- **ログインできない**：手順1-3で「Auto Confirm User」にチェックしたか確認
- **保存に失敗する**：手順1-2のSQLが最後まで実行されたか確認
- **しばらく使わなかったら動かない**：Supabaseの無料プロジェクトは、長期間アクセスがないと一時停止することがあります。ダッシュボードで「Restore」すれば戻ります
- **ウィジェットに「ログインしてください」と出る**：Scriptableでスクリプトをもう一度実行してログイン
