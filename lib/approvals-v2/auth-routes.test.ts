import assert from 'node:assert/strict';
import test from 'node:test';
import { GET as list, POST as create } from '../../app/api/approval-requests/route';
import { GET as detail, PATCH as patch } from '../../app/api/approval-requests/[id]/route';
import { GET as byTask } from '../../app/api/approval-requests/by-task/[taskId]/route';
import { POST as send } from '../../app/api/approval-requests/[id]/send/route';
import { POST as issue } from '../../app/api/approval-requests/[id]/link/issue/route';
import { POST as extend } from '../../app/api/approval-requests/[id]/link/extend/route';
import { POST as revoke } from '../../app/api/approval-requests/[id]/link/revoke/route';
import { POST as archive } from '../../app/api/approval-requests/[id]/archive/route';
import { POST as unarchive } from '../../app/api/approval-requests/[id]/unarchive/route';
import { POST as owner } from '../../app/api/approval-requests/[id]/owner/route';
import { POST as versions } from '../../app/api/approval-requests/[id]/versions/route';
import { POST as final } from '../../app/api/approval-requests/[id]/final/route';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const context = {
  params: Promise.resolve({
    id
  })
};
function bot(method = 'POST') {
  return new Request(`https://local.test/api/approval-requests/${id}`, {
    method,
    headers: {
      authorization: 'Bearer seo_bot_fixture',
      'Content-Type': 'application/json'
    },
    ...(method === 'GET' ? {} : {
      body: '{}'
    })
  });
}
test('every actual v2 route rejects bot keys before cookies or service credentials are used', async () => {
  assert.equal((await list(bot('GET'))).status, 401);
  assert.equal((await create(bot())).status, 401);
  assert.equal((await detail(bot('GET'), context)).status, 401);
  assert.equal((await byTask(bot('GET'), {
    params: Promise.resolve({
      taskId: id
    })
  })).status, 401);
  for (const route of [patch, send, issue, extend, revoke, archive, unarchive, owner, versions, final]) {
    const response = await route(bot(), context);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'forbidden');
  }
});
