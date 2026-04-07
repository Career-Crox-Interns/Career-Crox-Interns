import React from 'react';
import GenericTablePage from '../components/GenericTablePage';

export default function DuplicateProfilesPage() {
  return (
    <GenericTablePage
      title="Duplicate Profiles"
      subtitle="Profiles parked during upload because a filled profile already existed or a newer upload replaced an incomplete one."
      endpoint="/api/candidates?duplicate_only=1&page_size=100"
      rowHref={(row) => `/candidate/${row.candidate_id}`}
      pollMs={4000}
      columns={[
        { key: 'candidate_id', label: 'Candidate ID' },
        { key: 'full_name', label: 'Name' },
        { key: 'phone', label: 'Number' },
        { key: 'recruiter_code', label: 'Recruiter' },
        { key: 'status', label: 'Status' },
        { key: 'manager_crm', label: 'Reference' },
        { key: 'data_notes', label: 'Duplicate Reason', render: (row) => row.data_notes || row.follow_up_note || '-' },
        { key: 'updated_at', label: 'Updated At' },
      ]}
    />
  );
}
