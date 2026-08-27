import test from 'node:test';
import assert from 'node:assert/strict';
import { timeLogCommentBody, escapeHtml, formatLogDate } from './time-log-comment.ts';

const base = {
    taskTitle: 'August Content: 4 Blogs, 1 Category, 1 Refresh',
    hours: 2.75,
    date: '2026-08-26',
    actorName: 'Carlos Morones',
};

test('a note reaches the to-do with its hours and date', () => {
    const body = timeLogCommentBody({
        ...base,
        description: '"Van Electrical System Planning Checklist" blog post',
    });
    assert.ok(body);
    assert.match(body, /Van Electrical System Planning Checklist/);
    assert.match(body, /2\.75h/);
    assert.match(body, /Aug 26/);
    assert.match(body, /Carlos Morones/);
});

test('a description that is only the task title says nothing', () => {
    // The ledger falls back to the title when no note is written; posting that
    // back onto the to-do would repeat its own title on every log.
    assert.equal(timeLogCommentBody({ ...base, description: base.taskTitle }), null);
    assert.equal(timeLogCommentBody({ ...base, description: `  ${base.taskTitle}  ` }), null);
});

test('an empty description says nothing', () => {
    assert.equal(timeLogCommentBody({ ...base, description: '' }), null);
    assert.equal(timeLogCommentBody({ ...base, description: '   ' }), null);
    assert.equal(timeLogCommentBody({ ...base, description: null }), null);
});

test('a note is escaped, never interpolated', () => {
    const body = timeLogCommentBody({
        ...base,
        description: '<script>alert(1)</script> A&B "quoted"',
    });
    assert.ok(body);
    assert.ok(!body.includes('<script>'), 'raw markup must not survive');
    assert.match(body, /&lt;script&gt;/);
    assert.match(body, /A&amp;B/);
    assert.match(body, /&quot;quoted&quot;/);
});

test('a note still posts when the task has no title to compare', () => {
    const body = timeLogCommentBody({ ...base, taskTitle: null, description: 'Drafted two blogs' });
    assert.ok(body);
    assert.match(body, /Drafted two blogs/);
});

test('the actor is omitted rather than left blank', () => {
    const body = timeLogCommentBody({ ...base, actorName: null, description: 'Drafted two blogs' });
    assert.ok(body);
    assert.match(body, /2\.75h · Aug 26<\/em>/);
});

test('dates are read by parts so the day never shifts', () => {
    // new Date('2026-08-26') is UTC midnight and renders as Aug 25 west of it.
    assert.equal(formatLogDate('2026-08-26'), 'Aug 26');
    assert.equal(formatLogDate('2026-01-01'), 'Jan 1');
    assert.equal(formatLogDate('2026-12-31T10:00:00Z'), 'Dec 31');
});

test('escapeHtml covers the characters that break rich text', () => {
    assert.equal(escapeHtml('<a href="x">&\'</a>'),
        '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

import { commentTargetFor } from './time-log-comment.ts';

test('a task to-do in the authorized project is the comment target', () => {
    assert.equal(
        commentTargetFor({ taskBasecampTodoId: 77, taskBasecampProjectId: 202 }, '202'),
        '77',
    );
});

test('numeric and string ids are the same id', () => {
    // The route compares a normalized string against the authorized project id;
    // a type mismatch here would silently post no comment at all.
    assert.equal(
        commentTargetFor({ taskBasecampTodoId: '77', taskBasecampProjectId: '202' }, '202'),
        '77',
    );
});

test('a to-do from another project is never commented on', () => {
    // How one client's note reaches another client's to-do.
    assert.equal(
        commentTargetFor({ taskBasecampTodoId: 77, taskBasecampProjectId: 303 }, '202'),
        null,
    );
});

test('a task with no linked to-do has nowhere to comment', () => {
    assert.equal(
        commentTargetFor({ taskBasecampTodoId: null, taskBasecampProjectId: 202 }, '202'),
        null,
    );
});

test('a malformed id is refused rather than coerced', () => {
    assert.equal(
        commentTargetFor({ taskBasecampTodoId: 'abc', taskBasecampProjectId: 202 }, '202'),
        null,
    );
});
