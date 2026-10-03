import React from 'react';
import { useParams } from 'react-router-dom';
import CandidateDetailPage from './CandidateDetailPage';

export default function CandidateDetailRoute() {
  const { candidateId = '' } = useParams();
  return <CandidateDetailPage routeCandidateId={candidateId} />;
}
