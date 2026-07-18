# アーキテクチャ

```text
Discord Activity / 通常ブラウザ
  React + Vite
    ├─ Supabase Auth
    ├─ Supabase PostgreSQL + RLS
    ├─ Supabase Realtime
    └─ Supabase Storage
```

## 同期方式

- タスク、予定、コメント、リンク、添付メタ情報はPostgres Changesで反映
- 閲覧中、入力中はPresenceで共有
- 本文は最後の入力から3秒後に保存
- `task_pages.version` を条件付き更新し、同時保存を検知

## 権限

- owner: 全管理
- admin: 招待、メンバー管理、編集
- member: 通常編集
- viewer: 将来は読み取り専用に細分化予定

現状のSQLではviewerも一部書き込み可能です。厳密な読み取り専用化は、書き込みポリシーでmember以上を判定する関数を追加してください。
