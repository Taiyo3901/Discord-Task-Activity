.# デプロイ手順

すべて無料枠で完結します（Discord Developer Portal / Supabase Free / Vercel Hobby）。持続稼働するBotプロセスは使いません。

## 0. 全体構成

```
Discordクライアント(ボイスチャンネル埋め込み)
  → Vercel(React SPA, 無料)
      → "/supabase" 経由でSupabase(無料プロジェクト)を呼ぶ
          - Postgres + RLS
          - Edge Functions (discord-token-exchange, discord-interactions)
          - pg_cron + pg_net (期限リマインドをDiscord Webhookへ直接POST)
```

## 1. Discord Developer Portal

1. https://discord.com/developers/applications で新規Application作成。
2. 左メニュー「Activities」を有効化。
3. 「OAuth2」→ Client IDを控える（`VITE_DISCORD_CLIENT_ID` / `DISCORD_CLIENT_ID`）。「Reset Secret」でClient Secretを発行し控える（`DISCORD_CLIENT_SECRET`、フロントエンドには絶対に置かない）。
4. 「General Information」の下部にある「Public Key」を控える（`DISCORD_PUBLIC_KEY`、スラッシュコマンド検証用）。
5. 「Activities」→「URL Mappings」で以下を設定（上から順に評価されるため、キャッチオール `/` は一番下）。
   | Prefix | Target |
   | --- | --- |
   | `/supabase` | `<project-ref>.supabase.co` |
   | `/` | Vercelのデプロイドメイン |
6. 「Interactions Endpoint URL」に、後述のEdge Function `discord-interactions` のURLを設定（Discordが即座にPINGを送るので、先にEdge Functionをデプロイしてから設定する）。
7. スラッシュコマンドを登録する場合は、Discord公式のREST APIか`discord.js`等で `/task add` コマンド（`title`必須文字列オプション、`due`任意文字列オプション）をアプリケーションコマンドとして一度登録してください（登録はローカルから一度実行すればよく、常駐プロセスは不要です）。

## 2. Supabase

無料プロジェクトを1つ作成し、プロジェクトルートで以下を実行します（`supabase`はdevDependenciesに追加済みなので`npx supabase`で使えます）。

```cmd
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

`supabase/migrations/001_init.sql` と `002_redesign.sql` が適用されます。`002_redesign.sql`はpg_cron/pg_netの有効化とcronジョブ登録も含みますが、プロジェクトによっては先にDashboardの `Database > Extensions` でpg_cron / pg_netを手動でONにする必要がある場合があります。失敗した場合はDashboardでONにしてから、SQL Editorで次の2行だけ再実行してください。

```sql
select cron.unschedule(jobid) from cron.job where jobname = 'notify-due-tasks';
select cron.schedule('notify-due-tasks', '*/30 * * * *', $$select public.notify_due_tasks()$$);
```

Edge Functionsをデプロイします。

```cmd
npx supabase functions deploy discord-token-exchange
npx supabase functions deploy discord-interactions
```

Functionのシークレットを設定します（`SUPABASE_URL`と`SUPABASE_SERVICE_ROLE_KEY`はSupabaseが自動注入するため設定不要です）。

```cmd
npx supabase secrets set DISCORD_CLIENT_ID=xxxx
npx supabase secrets set DISCORD_CLIENT_SECRET=xxxx
npx supabase secrets set DISCORD_PUBLIC_KEY=xxxx
npx supabase secrets set SUPABASE_JWT_SECRET=xxxx
```

`SUPABASE_JWT_SECRET`は Dashboard → Project Settings → API → 「JWT Secret」（レガシー、非対称鍵に切り替え済みの場合は表示名が異なることがあります）からコピーしてください。

> **既知の制約**: このアプリはSupabaseのレガシーJWTシークレット(HS256)で自前JWTを署名し、`auth.uid()`を成立させています。Supabaseは将来的に非対称鍵ベースの「Third-Party Auth」への移行を推奨していますが、現時点ではレガシーシークレットが有効な限りこの方式は動作します。Dashboardでレガシーシークレットが見当たらない場合はSupabaseサポート/ドキュメントで最新の移行状況を確認してください。

StorageバケットとRLSは`001_init.sql`/`002_redesign.sql`の適用で自動的に作成されます。

## 3. Vercel

1. リポジトリをVercelにImport。
2. 環境変数を設定（Production/Preview両方）。

   | Key | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | Supabase Dashboardの anon/public key |
   | `VITE_DISCORD_CLIENT_ID` | DiscordのClient ID |

3. Deploy（Hobbyプラン、無料）。
4. デプロイ後のドメインを、手順1-5の「URL Mappings」の `/` ターゲットに設定してください。

## 4. 動作確認

- ブラウザで直接VercelのURLを開くと、通常のSupabase Discord OAuthログイン画面が出ます（Discord Activity外でのフォールバック、開発確認用）。この場合、Supabase Dashboard の Authentication → Providers → Discord で Client ID/Secret を別途設定しておく必要があります。
- Discordデスクトップアプリでボイスチャンネルに入り、Activity一覧からこのアプリを起動すると、自動的にDiscordアカウントでログインされ、ボードが表示されます。
- 複数アカウントで同じタスクを同時に開き、プレゼンス表示・自動保存・競合検知が動くことを確認してください。
- グループ設定でDiscord Webhook URLを登録し、期限を今日の日付にしたタスクを作成後、最大30分待つ（またはSQL Editorで`select public.notify_due_tasks();`を手動実行）とDiscordチャンネルに通知が届きます。
- Discordサーバーの任意チャンネルで `/task add title:テスト` を実行し、該当グループにタスクが追加されることを確認してください（グループ設定でサーバーIDを連携し、実行者がTask Activityでログイン済みである必要があります）。

## ローカル開発

```cmd
npm install
npm run dev
```

`.env`に`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_DISCORD_CLIENT_ID`を設定してください（`.env.example`参照）。`npm run dev`はDiscord Activity外のブラウザとして起動するため、上記「ブラウザで直接開く」フォールバック経路が使われます。
