import { useEffect } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

/** Postgres Changesの通知が来たらReact Queryのキャッシュを無効化して再取得させる。 */
export function useRealtimeInvalidate(client: SupabaseClient, channelName: string, table: string, filter: string, queryKey: QueryKey) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = client
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table, filter }, () => {
        void queryClient.invalidateQueries({ queryKey });
      })
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, channelName, table, filter]);
}
