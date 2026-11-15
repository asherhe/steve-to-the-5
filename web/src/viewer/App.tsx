import { createCatalogClient } from '../inspector';
import { createFindingsClient, FindingsApiError } from '../findings/api';
import { createAuthGateway } from '../findings/auth';
import { AccountProvider, AccountControls, useAccount } from '../findings/Account';
import { CandidateReviewPane, type CandidateReviewSlotProps } from '../findings/CandidateReviewPane';
import { CommunityActivity, type CommunityActivityProps } from '../findings/CommunityActivity';
import { FindingThread } from '../findings/FindingThread';
import { EvidenceReplayError, type EvidenceDiscussionProps } from './evidence';
import { Viewer } from './Viewer';
import { createViewerDataSource, createWiseDataSource } from './production';
import retainedExample from '../../../fixtures/archive/real-barnard/response.json';
import { mockAuth, mockFindings } from '../findings/mock';

// Default to an unmistakable local simulation until real findings/auth are configured.
const demo = import.meta.env.VITE_LIVE_FINDINGS !== '1';
const auth = demo ? mockAuth : createAuthGateway();
const findings = demo ? mockFindings : createFindingsClient({ getAuthHeaders: () => auth.headers() });
const dataSource = createViewerDataSource();
const catalog = createCatalogClient();
const leaderboard = { list: findings.leaderboard };
const loadFinding = async (id: string, signal?: AbortSignal) => {
  try { return await findings.getFinding(id, signal); }
  catch (error) {
    if (signal?.aborted) throw error;
    if (demo && error instanceof Error && error.message === 'Demo finding not found.') return null;
    if (error instanceof FindingsApiError && error.status === 404) return null;
    throw new EvidenceReplayError(error instanceof FindingsApiError ? error.message : 'The finding could not be loaded. Try again.');
  }
};
function Review(props: CandidateReviewSlotProps) {
  const account = useAccount();
  return <CandidateReviewPane {...props} simulation={demo} client={findings} session={account.session} onRequestSignIn={account.requestSignIn} />;
}
function Activity(props: CommunityActivityProps) { return <CommunityActivity {...props} client={findings} />; }
function Discussion(props: EvidenceDiscussionProps) {
  const account = useAccount();
  return <FindingThread client={findings} session={account.session} findingId={props.finding.id} onClose={() => props.onClose?.()} onRequestSignIn={account.requestSignIn} onShowEvidence={() => props.onShowEvidence(props.finding)} />;
}
export function App() {
  return <AccountProvider gateway={auth}><Viewer dataSource={dataSource} wiseDataSource={createWiseDataSource} leaderboard={leaderboard} loadFinding={loadFinding} Discussion={Discussion} Review={Review} checkPoint={catalog.review} Account={demo ? undefined : AccountControls} Activity={Activity} savedExampleId={retainedExample.comparison.id} /></AccountProvider>;
}
