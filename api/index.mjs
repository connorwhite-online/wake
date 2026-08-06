// Vercel serverless entrypoint: read-only wake API over the spaces bundled
// with the deployment. Indexes are rebuilt into /tmp on cold start (the
// bundle's filesystem is read-only); writes still happen against a real
// deployment — pushing to git is what updates this mirror.
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { handle } from 'hono/vercel';
import { Hub, looksLikeSpace } from '../packages/wake/dist/core/spaces.js';
import { buildApi } from '../packages/wake/dist/http/api.js';

process.env.WAKE_INDEX_DIR ||= '/tmp';

const cwd = process.cwd();
const legacy = path.resolve(cwd, 'workspace');
const hub = looksLikeSpace(legacy) ? Hub.single(legacy) : Hub.open(path.resolve(cwd, process.env.WAKE_HOME || '.'));
const app = buildApi(hub, new EventEmitter());

export default handle(app);
