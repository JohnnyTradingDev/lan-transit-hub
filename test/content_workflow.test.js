const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createContentWorkflow } = require('../content_workflow');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-workflow-'));
  fs.writeFileSync(path.join(dir, 'content_routes.json'), JSON.stringify([{
    id: 'money', name: 'Money', deviceLabel: 'Samsung', matchKeywords: ['samsung'],
    platforms: ['x'], promise: 'Education', pillars: [], weeklyMix: {},
    disclosure: 'Hợp tác BingX; không phải lời khuyên tài chính.', guardrails: []
  }]));
  return { dir, workflow: createContentWorkflow(dir) };
}

test('creates a draft and adds disclosure for BingX content', () => {
  const { dir, workflow } = setup();
  try {
    const item = workflow.createItem({
      routeId: 'money', platform: 'x', title: 'Risk checklist', caption: 'Three checks.',
      sourceUrl: 'https://example.com/source', bingxRelated: true
    });
    assert.equal(item.status, 'draft');
    assert.match(item.disclosure, /BingX/);
    assert.equal(workflow.getStats().draft, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('requires approval before handoff and enforces transitions', () => {
  const { dir, workflow } = setup();
  try {
    const item = workflow.createItem({ routeId: 'money', platform: 'x', title: 'T', caption: 'C' });
    assert.throws(() => workflow.markSent(item.id, { id: 'phone', name: 'Phone' }), /duyệt/);
    workflow.updateItem(item.id, { status: 'ready' });
    const sent = workflow.markSent(item.id, { id: 'phone', name: 'Phone' });
    assert.equal(sent.status, 'sent');
    assert.equal(sent.targetDeviceId, 'phone');
    assert.throws(() => workflow.updateItem(item.id, { status: 'draft' }), /Không thể chuyển/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('rejects unsupported platforms and unsafe URL protocols', () => {
  const { dir, workflow } = setup();
  try {
    assert.throws(() => workflow.createItem({ routeId: 'money', platform: 'instagram', title: 'T', caption: 'C' }), /Nền tảng/);
    assert.throws(() => workflow.createItem({ routeId: 'money', platform: 'x', title: 'T', caption: 'C', sourceUrl: 'file:///secret' }), /http/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
