// Vercel serverless entrypoint: read-only wake API over the workspace/
// directory bundled with the deployment. The SQLite index is rebuilt into
// /tmp on cold start (the bundle's filesystem is read-only); writes still
// happen locally over MCP — pushing to git is what updates this deployment.
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { handle } from 'hono/vercel';
import { Workspace } from '../packages/wake/dist/core/workspace.js';
import { buildApi } from '../packages/wake/dist/http/api.js';

process.env.WAKE_DB ||= '/tmp/wake-index.db';
const root = path.resolve(process.cwd(), process.env.WAKE_SPACE || 'workspace');

const ws = Workspace.open(root);
const app = buildApi(ws, new EventEmitter());

export default handle(app);
