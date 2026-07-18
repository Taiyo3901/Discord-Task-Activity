# Discord Task Activity Starter

Discord Activityとして利用できる、小規模チーム向け予定・タスク管理WebアプリのMVPです。

## 実装済み

- Discord / Google OAuthログイン
- Discord IDによるメンバー招待
- グループ作成とRLS権限管理
- タスクの作成、一覧、ステータス変更
- タスクページ本文の3秒後自動保存
- 誰が閲覧中、入力中かをPresenceで表示
- バージョン番号による競合検知
- 予定の作成とリアルタイム反映
- 関連URL、コメント、添付ファイル
- Vercel向けSPA設定

## 1. 必要なもの

- Node.js 20以上
- npm
- Supabaseアカウント
- Discord Developer Portalのアプリ
- Google CloudのOAuthクライアント。Googleログインを使う場合
- GitHubアカウント
- Vercelアカウント

## 2. ローカル起動

```bash
cp .env.example .env
npm install
npm run dev
```

`http://localhost:5173` を開きます。

`.env` に以下を設定します。

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_DISCORD_CLIENT_ID=YOUR_DISCORD_APPLICATION_ID
```

`VITE_` で始まる値はブラウザへ公開されます。秘密鍵、Service Role Key、Discord Bot Token、OAuth Client Secretは入れないでください。

## 3. Supabase作成

1. Supabaseで新規プロジェクトを作成します。
2. SQL Editorを開きます。
3. `supabase/migrations/001_init.sql` を全文実行します。
4. Authentication > ProvidersでDiscordとGoogleを有効化します。
5. Authentication > URL Configurationを設定します。

開発時の例:

```text
Site URL: http://localhost:5173
Redirect URLs:
http://localhost:5173
http://localhost:5173/**
```

SupabaseのDiscord / Google Provider画面に表示されるCallback URLは通常次の形式です。

```text
https://YOUR_PROJECT.supabase.co/auth/v1/callback
```

このURLをDiscord Developer PortalとGoogle CloudのOAuth Redirect URIへ登録します。

## 4. Discord設定

1. Discord Developer PortalでApplicationを作成します。
2. OAuth2でSupabase Callback URLをRedirectに登録します。
3. Activitiesを有効化します。
4. 開発時はHTTPSトンネル、公開後はVercel URLをURL Mappingへ設定します。
5. Activity起動用Entry Point Commandを設定します。

Discord User ID招待を使うメンバーは、SupabaseのDiscordログインを一度行い、`profiles.discord_user_id` が登録された状態にしてください。

## 5. ビルド確認

```bash
npm run typecheck
npm run build
npm run preview
```

`http://localhost:4173` を開きます。

## 6. GitHubへpush

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/discord-task-activity.git
git push -u origin main
```

`.env` はpushしません。

## 7. Vercel公開

1. VercelのNew ProjectからGitHubリポジトリをImportします。
2. Framework PresetはViteを選択します。
3. Build Commandは`npm run build`です。
4. Output Directoryは`dist`です。
5. Environment Variablesへ`.env`と同じ3項目を登録します。
6. Deployします。

発行例:

```text
https://discord-task-activity.vercel.app
```

## 8. 公開後のSupabase設定

Authentication > URL Configuration:

```text
Site URL:
https://discord-task-activity.vercel.app

Redirect URLs:
https://discord-task-activity.vercel.app
https://discord-task-activity.vercel.app/**
http://localhost:5173/**
```

## 9. Discord Activityへ本番URLを設定

Discord Developer PortalのActivities / URL Mappingで、ルート `/` をVercelのホストへ割り当てます。

```text
Prefix: /
Target: discord-task-activity.vercel.app
```

UIが変わっている場合は、Application URLまたはURL Mappingの入力欄へ本番HTTPS URLを設定してください。

## 10. 動作テスト

- Discordログイン、Googleログイン
- グループ作成
- Discord User IDで招待
- 別ユーザーでActivityを開き招待自動承認
- タスク作成、ステータス変更
- 二つのブラウザで本文を開き、入力中表示
- 入力停止3秒後の保存と他画面への反映
- 同時保存時の競合表示
- URL、コメント、10MB以下の添付ファイル
- 予定のリアルタイム反映

## 11. 既知の制約

- Discord Activity内のOAuthリダイレクト挙動は、DiscordクライアントとURL Mappingの設定に依存します。最初は通常ブラウザで認証を確認してからActivityへ組み込んでください。
- Google Calendar、Google Tasks、Google DocsのAPI同期は未実装です。
- Discord Bot、Slash Command、期限通知、スレッド自動作成は未実装です。
- 本文は文字単位CRDT共同編集ではなく、入力中表示と3秒後保存、競合検知方式です。

## 12. 次の開発候補

1. Discord Embedded App SDKの認可コードをサーバー側でトークン交換
2. Discord BotとSlash Command
3. 期限通知と定期実行
4. Google Calendarの読み込み、書き込み
5. Google Tasks連携
6. Google Docsへの出力
7. 編集履歴、差分、復元
8. 月、週カレンダーUI
