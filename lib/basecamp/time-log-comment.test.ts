import test from 'node:test';
import assert from 'node:assert/strict';
import { timeLogCommentBody, escapeHtml } from './time-log-comment.ts';

const base = {
    taskTitle: 'August Content: 4 Blogs, 1 Category, 1 Refresh',
};

test('a note reaches the to-do without repeating timesheet or author metadata', () => {
    const body = timeLogCommentBody({
        ...base,
        description: '"Van Electrical System Planning Checklist" blog post',
    });
    assert.equal(body, '<div>&quot;Van Electrical System Planning Checklist&quot; blog post</div>');
    assert.doesNotMatch(body, /2\.75h|Aug 26|Carlos Morones/);
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

test('several session notes remain separate readable paragraphs', () => {
    assert.equal(
        timeLogCommentBody({ ...base, description: 'Investigated indexing\n\nPublished two blogs' }),
        '<div>Investigated indexing</div><div>Published two blogs</div>',
    );
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
