import { useState, useEffect, useCallback } from 'react';

export function useAsync(fn, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    return Promise.resolve(fn()).then((d) => { setData(d); setLoading(false); return d; })
      .catch((e) => { console.error(e); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { data, loading, reload: load, setData };
}
