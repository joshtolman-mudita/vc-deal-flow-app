import { useState } from 'react';
import { DiligenceRecord } from '@/types/diligence';

interface UseDiligenceActionsProps {
  id: string;
  record: DiligenceRecord | null;
  setRecord: (record: DiligenceRecord | null) => void;
  setError: (error: string | null) => void;
  refetch: () => Promise<void>;
}

/**
 * Custom hook for diligence record actions (rescore, sync, delete, etc.)
 */
export function useDiligenceActions({
  id,
  record,
  setRecord,
  setError,
  refetch,
}: UseDiligenceActionsProps) {
  const [rescoring, setRescoring] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /**
   * Re-score the diligence record using AI
   */
  const handleRescore = async () => {
    if (!record) return;

    setRescoring(true);
    setError(null);

    try {
      const response = await fetch('/api/diligence/rescore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diligenceId: id }),
      });

      const data = await response.json();

      if (data.success && data.record) {
        setRecord(data.record);
        
        // Show re-score explanation if available
        if (data.rescoreExplanation) {
          alert(`Score Updated!\n\n${data.rescoreExplanation}`);
        }
      } else {
        setError(data.error || 'Failed to re-score');
        console.error('Re-score failed:', data);
      }
    } catch (err) {
      console.error('Error re-scoring:', err);
      setError('Failed to re-score. Please try again.');
    } finally {
      setRescoring(false);
    }
  };

  /**
   * Sync diligence record to HubSpot
   */
  const handleSyncToHubSpot = async (dealStage?: string) => {
    if (!record) return;

    setSyncing(true);
    setError(null);

    try {
      const response = await fetch('/api/diligence/hubspot-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          diligenceId: id,
          dealStage: dealStage || undefined,
        }),
      });

      const data = await response.json();

      if (data.success) {
        alert(`Successfully synced to HubSpot! Deal ID: ${data.dealId}`);
        window.open(data.dealUrl, '_blank');
        await refetch(); // Refresh to get hubspotDealId
        return true;
      } else {
        setError(data.error || 'Failed to sync to HubSpot');
        return false;
      }
    } catch (err) {
      console.error('Error syncing to HubSpot:', err);
      setError('Failed to sync to HubSpot');
      return false;
    } finally {
      setSyncing(false);
    }
  };

  /**
   * Delete the diligence record
   */
  const handleDelete = async (archiveFolder: boolean = false) => {
    if (!record) return false;

    if (!confirm(`Are you sure you want to delete the diligence for ${record.companyName}?`)) {
      return false;
    }

    setDeleting(true);
    setError(null);

    try {
      const response = await fetch(`/api/diligence/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archiveFolder }),
      });

      const data = await response.json();

      if (data.success) {
        return true;
      } else {
        setError(data.error || 'Failed to delete diligence');
        return false;
      }
    } catch (err) {
      console.error('Error deleting diligence:', err);
      setError('Failed to delete diligence');
      return false;
    } finally {
      setDeleting(false);
    }
  };

  return {
    rescoring,
    syncing,
    deleting,
    handleRescore,
    handleSyncToHubSpot,
    handleDelete,
  };
}
