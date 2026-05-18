// SPDX-License-Identifier: AGPL-3.0-only

import { Hono } from 'hono';
import { loadEnv } from './env.js';
import { initialiseMetrics } from './metrics.js';
import { corsAndOriginCheck } from './middleware/cors.js';
import { errorEnvelope } from './middleware/error-envelope.js';
import { requestId } from './middleware/request-id.js';
import { securityHeaders } from './middleware/security-headers.js';
import { registerAdminAuditRoutes } from './routes/admin/audit.js';
import { registerAdminInvitationRoutes } from './routes/admin/invitations.js';
import { registerAdminUserRoutes } from './routes/admin/users.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerJwksRoute } from './routes/jwks.js';
import { registerLinkRoutes } from './routes/link.js';
import { registerLoginRoutes } from './routes/login.js';
import { registerMeRoutes } from './routes/me.js';
import { registerMetricsRoute } from './routes/metrics.js';
import { registerRecoveryRoutes } from './routes/recovery.js';
import { registerTokenRoutes } from './routes/token.js';

export function createServer(): Hono {
  initialiseMetrics();
  const env = loadEnv();
  const app = new Hono();

  app.onError(errorEnvelope);
  app.use('*', requestId());
  app.use('*', securityHeaders());
  app.use('*', corsAndOriginCheck(env.CORS_ALLOWED_ORIGINS));

  registerHealthRoutes(app);
  registerMetricsRoute(app);
  registerJwksRoute(app);
  registerTokenRoutes(app);
  registerAuthRoutes(app);
  registerLinkRoutes(app);
  registerLoginRoutes(app);
  registerRecoveryRoutes(app);
  registerMeRoutes(app);
  registerAdminUserRoutes(app);
  registerAdminInvitationRoutes(app);
  registerAdminAuditRoutes(app);
  return app;
}
