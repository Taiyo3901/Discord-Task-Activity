import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { ToastProvider } from "./components/ui/ToastProvider";
import { DiscordActivityGate } from "./auth/DiscordActivityGate";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <DiscordActivityGate />
      </ToastProvider>
    </QueryClientProvider>
  );
}
