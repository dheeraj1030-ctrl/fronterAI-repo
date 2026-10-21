import { handleAuthRoutes } from './authRoutes.js';
import { handleMemberRoutes } from './memberRoutes.js';
import { handleDashboardRoutes } from './dashboardRoutes.js';
import { handleMeetingRoutes } from './meetingRoutes.js';
import { handleCalendarRoutes } from './calendarRoutes.js';
import { handleTaskRoutes } from './taskRoutes.js';
import { handleVotingRoutes } from './votingRoutes.js';
import { handleTaskletRoutes } from './taskletRoutes.js';
import { handleGovernanceRoutes } from './governanceRoutes.js';
import { handleAuditRoutes } from './auditRoutes.js';
import { handleDisasterRecoveryRoutes } from './disasterRecoveryRoutes.js';
import { handleAiRoutes } from './aiRoutes.js';
import { handleStaticRoutes } from './staticRoutes.js';
import { sendJson } from '../middleware/httpHelpers.js';

export async function dispatchRoutes(req, res, pathname, method, urlObj) {
  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Sequentially evaluate route handlers; exit as soon as any handler writes headers/response
  await handleAuthRoutes(req, res, pathname, method, urlObj);
  if (res.headersSent || res.writableEnded) return;

  await handleMemberRoutes(req, res, pathname, method);
  if (res.headersSent || res.writableEnded) return;

  await handleDashboardRoutes(req, res, pathname, method);
  if (res.headersSent || res.writableEnded) return;

  await handleMeetingRoutes(req, res, pathname, method);
  if (res.headersSent || res.writableEnded) return;

  await handleCalendarRoutes(req, res, pathname, method, urlObj);
  if (res.headersSent || res.writableEnded) return;

  await handleTaskRoutes(req, res, pathname, method);
  if (res.headersSent || res.writableEnded) return;

  await handleVotingRoutes(req, res, pathname, method, urlObj);
  if (res.headersSent || res.writableEnded) return;

  await handleTaskletRoutes(req, res, pathname, method);
  if (res.headersSent || res.writableEnded) return;

  await handleGovernanceRoutes(req, res, pathname, method);
  if (res.headersSent || res.writableEnded) return;

  await handleAuditRoutes(req, res, pathname, method);
  if (res.headersSent || res.writableEnded) return;

  await handleDisasterRecoveryRoutes(req, res, pathname, method);
  if (res.headersSent || res.writableEnded) return;

  await handleAiRoutes(req, res, pathname, method);
  if (res.headersSent || res.writableEnded) return;

  if (handleStaticRoutes(req, res, pathname)) return;
  if (res.headersSent || res.writableEnded) return;

  // 404 Route Not Found
  return sendJson(res, 404, { error: 'Route not found' });
}
