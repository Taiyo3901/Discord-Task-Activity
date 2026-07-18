import { useEffect } from "react";
import { AuthGate } from "./auth/AuthGate";
import { initDiscordSdk } from "./lib/discord";

export default function App() {
  useEffect(() => {
    void initDiscordSdk();
  }, []);

  return <AuthGate />;
}
