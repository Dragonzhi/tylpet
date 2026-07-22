import { useCallback, useState } from "react";

export function useLog() {
  const [log, setLog] = useState<string[]>([]);

  const addLog = useCallback((message: string) => {
    setLog((previous) => [...previous.slice(-149), message]);
  }, []);

  return { log, addLog };
}
