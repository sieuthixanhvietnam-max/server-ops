import { getJob } from '@/services/serverOps/api';
import { useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 1200;

export function useJobPolling(jobId: number | undefined) {
  const [job, setJob] = useState<API.JobDetail>();
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!jobId) {
      setJob(undefined);
      return;
    }
    let cancelled = false;

    const poll = async () => {
      try {
        const data = await getJob(jobId);
        if (cancelled) return;
        setJob(data);
        if (data.status === 'running' || data.status === 'pending') {
          timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch {
        // A single transient poll failure (network blip, brief backend
        // restart) must not permanently kill polling - without this, the
        // UI is stuck on the last-known "running" state forever even after
        // the job actually finishes, since nothing schedules the next poll.
        if (cancelled) return;
        timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
    };
  }, [jobId]);

  return job;
}
