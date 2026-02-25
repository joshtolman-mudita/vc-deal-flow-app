import { useState, useEffect } from 'react';
import { DiligenceRecord } from '@/types/diligence';

/**
 * Custom hook for managing diligence record state and fetching
 */
export function useDiligenceRecord(id: string) {
  const [record, setRecord] = useState<DiligenceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecord = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/diligence/${id}`);
      const data = await response.json();

      if (data.success && data.record) {
        setRecord(data.record);
      } else {
        setError(data.error || 'Failed to load diligence record');
      }
    } catch (err) {
      console.error('Error fetching record:', err);
      setError('Failed to load diligence record');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecord();
  }, [id]);

  return {
    record,
    setRecord,
    loading,
    error,
    setError,
    refetch: fetchRecord,
  };
}
