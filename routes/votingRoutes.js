import { db, logAudit } from '../db.js';
import { getSessionUser } from '../middleware/session.js';
import { parseBody, sendJson } from '../middleware/httpHelpers.js';
import { generateBallotToken, verifyBallotToken } from '../services/ballotCrypto.js';

export async function handleVotingRoutes(req, res, pathname, method, urlObj) {
  if (pathname === '/api/voting/current' && method === 'GET') {
    const currentUser = getSessionUser(req);
    const requestedId = parseInt(urlObj.searchParams.get('session_id') || '1', 10);
    const session = db.prepare('SELECT * FROM voting_sessions WHERE id = ?').get(requestedId) ||
                    db.prepare('SELECT * FROM voting_sessions ORDER BY id ASC LIMIT 1').get();
    if (!session) return sendJson(res, 404, { error: 'No voting session found' });

    const allSessions = db.prepare('SELECT id, title, description, session_type, status FROM voting_sessions ORDER BY id ASC').all();

    const candidates = db.prepare('SELECT id, name, role, team_track, email FROM members WHERE is_allowed = 1 ORDER BY id ASC').all();

    const eligibility = currentUser
      ? db.prepare('SELECT * FROM voting_eligibility WHERE session_id = ? AND member_id = ?').get(session.id, currentUser.id)
      : null;
    
    const totalBallots = db.prepare('SELECT COUNT(*) as count FROM ballots WHERE session_id = ?').get(session.id).count;
    const totalEligible = candidates.length || session.total_eligible;

    let tally = null;
    const isRevealed = totalBallots >= totalEligible || session.status === 'CLOSED';

    if (isRevealed) {
      tally = candidates.map(cand => {
        const stats = db.prepare(`
          SELECT 
            COUNT(*) as count,
            AVG(rating) as avg_rating
          FROM ballots 
          WHERE session_id = ? AND (candidate_member_id = ? OR option_id = ?)
        `).get(session.id, cand.id, cand.id);

        return {
          candidate_id: cand.id,
          candidate_name: cand.name,
          candidate_role: cand.role,
          team_track: cand.team_track,
          total_ratings: stats?.count || 0,
          avg_rating: stats?.count ? (Math.round((stats.avg_rating || 0) * 10) / 10) : 0
        };
      });
    }

    return sendJson(res, 200, {
      session,
      allSessions,
      candidates,
      options: candidates,
      userHasClaimedToken: !!eligibility,
      totalBallots,
      totalEligible,
      isRevealed,
      isHost: !!(currentUser && currentUser.is_host),
      tally
    });
  }

  // Phase 1: Claim blind token (Eligibility Check)
  if (pathname === '/api/voting/token' && method === 'POST') {
    const currentUser = getSessionUser(req);
    if (!currentUser) return sendJson(res, 401, { error: 'Authentication required to claim ballot token' });
    const body = await parseBody(req);
    const sessionId = body.session_id || 1;

    const existing = db.prepare('SELECT * FROM voting_eligibility WHERE session_id = ? AND member_id = ?')
      .get(sessionId, currentUser.id);

    if (existing) {
      return sendJson(res, 400, { error: 'You have already claimed a ballot token for this peer performance session.' });
    }

    db.prepare(`
      INSERT INTO voting_eligibility (session_id, member_id, token_issued_at)
      VALUES (?, ?, ?)
    `).run(sessionId, currentUser.id, new Date().toISOString());

    const blindToken = generateBallotToken(sessionId);

    logAudit(
      currentUser.handle,
      'CLAIM_BALLOT_TOKEN',
      `voting_session_${sessionId}`,
      `Member claimed unlinked blind token for peer performance review.`,
      'SUCCESS'
    );

    return sendJson(res, 200, {
      token: blindToken,
      instructions: 'This token is unlinked from your identity. Submit your vote with this token.'
    });
  }

  // Phase 2: Cast anonymous ballot
  if (pathname === '/api/voting/cast' && method === 'POST') {
    const body = await parseBody(req);
    const { session_id, option_id, candidate_id, rating, token } = body;
    const targetCandidateId = candidate_id || option_id;
    const numRating = Math.max(1, Math.min(5, parseInt(rating || 5, 10)));

    if (!session_id || !targetCandidateId || !token) {
      return sendJson(res, 400, { error: 'session_id, candidate_id, and token are required' });
    }

    const verification = verifyBallotToken(session_id, token);
    if (!verification.valid) {
      logAudit(
        'anonymous',
        'BALLOT_REJECTED',
        `voting_session_${session_id}`,
        `Invalid ballot signature: ${verification.error}`,
        'DENIED'
      );
      return sendJson(res, 403, { error: `Invalid ballot token: ${verification.error}` });
    }

    const alreadyUsed = db.prepare('SELECT * FROM used_tokens WHERE token_hash = ?').get(verification.tokenHash);
    if (alreadyUsed) {
      logAudit(
        'anonymous',
        'DOUBLE_VOTE_BLOCKED',
        `voting_session_${session_id}`,
        `Attempted double-vote using spent ballot token.`,
        'DENIED'
      );
      return sendJson(res, 409, { error: 'Double-voting prevented! This ballot token has already been cast.' });
    }

    db.prepare('INSERT INTO used_tokens (token_hash, used_at) VALUES (?, ?)').run(
      verification.tokenHash,
      new Date().toISOString()
    );

    db.prepare('INSERT INTO ballots (session_id, option_id, candidate_member_id, rating) VALUES (?, ?, ?, ?)').run(
      session_id,
      targetCandidateId,
      targetCandidateId,
      numRating
    );

    logAudit(
      'anonymous_voter',
      'PEER_BALLOT_CAST',
      `voting_session_${session_id}`,
      `Anonymous rating of ${numRating}/5 stars cast in peer performance review. Zero voter linkage.`,
      'SUCCESS'
    );

    return sendJson(res, 200, { message: 'Performance evaluation ballot safely cast into anonymous ballot box!' });
  }

  if (pathname === '/api/voting/close' && method === 'POST') {
    const currentUser = getSessionUser(req);
    if (!currentUser || !currentUser.is_host) {
      return sendJson(res, 403, { error: 'Permission Denied: Only the Team Host can close a voting session.' });
    }

    const body = await parseBody(req);
    const targetSessionId = body.session_id || 1;

    db.prepare(`UPDATE voting_sessions SET status = 'CLOSED', closed_at = ? WHERE id = ?`).run(new Date().toISOString(), targetSessionId);
    logAudit(currentUser.handle, 'CLOSE_VOTING_SESSION', `voting_session_${targetSessionId}`, `Host closed voting session #${targetSessionId} and revealed aggregate tallies.`, 'SUCCESS');

    return sendJson(res, 200, { message: `Voting session #${targetSessionId} closed. Final tallies revealed!` });
  }

  if (pathname === '/api/voting/reopen' && method === 'POST') {
    const currentUser = getSessionUser(req);
    if (!currentUser || !currentUser.is_host) {
      return sendJson(res, 403, { error: 'Permission Denied: Only the Team Host can reopen a voting session.' });
    }

    const body = await parseBody(req);
    const targetSessionId = body.session_id || 1;

    db.prepare(`UPDATE voting_sessions SET status = 'ACTIVE', closed_at = NULL WHERE id = ?`).run(targetSessionId);
    logAudit(currentUser.handle, 'REOPEN_VOTING_SESSION', `voting_session_${targetSessionId}`, `Host reopened voting session #${targetSessionId}.`, 'SUCCESS');

    return sendJson(res, 200, { message: `Voting session #${targetSessionId} reopened for evaluations.` });
  }

  return false;
}
