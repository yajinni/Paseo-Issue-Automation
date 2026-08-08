import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LEGACY_LABELS } from '../src/label-catalog.mjs';
import { loadRun, saveConfig, saveRun } from '../src/state.mjs';

function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }
function executable(file, content) { writeFileSync(file, content, { encoding: 'utf8', mode: 0o755 }); chmodSync(file, 0o755); }
function calls(file) { return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); }

test('controller fails closed when reviewer returns JSON without the required verdict', (t) => {
  if (process.platform === 'win32') return t.skip('acceptance fixture uses Unix executable shims');

  const fixture = mkdtempSync(path.join(os.tmpdir(), 'paseo-reviewer-malformed-'));
  const root = path.join(fixture, 'repo');
  const remote = path.join(fixture, 'origin.git');
  const bin = path.join(fixture, 'bin');
  const callsFile = path.join(fixture, 'calls.jsonl');
  mkdirSync(root, { recursive: true }); mkdirSync(bin, { recursive: true });
  t.after(() => rmSync(fixture, { recursive: true, force: true }));

  git(fixture, 'init', '--bare', '--quiet', remote);
  git(root, 'init', '--quiet', '-b', 'main');
  git(root, 'config', 'user.name', 'Paseo Acceptance');
  git(root, 'config', 'user.email', 'acceptance@example.invalid');
  writeFileSync(path.join(root, 'README.md'), '# malformed reviewer acceptance\n');
  git(root, 'add', 'README.md'); git(root, 'commit', '--quiet', '-m', 'Initial fixture');
  git(root, 'remote', 'add', 'origin', remote); git(root, 'push', '--quiet', '-u', 'origin', 'main');
  git(root, 'checkout', '--quiet', '-b', 'issue-202-malformed-review');
  writeFileSync(path.join(root, 'accepted-change.txt'), 'candidate exact head\n');
  git(root, 'add', 'accepted-change.txt'); git(root, 'commit', '--quiet', '-m', 'Add candidate change');
  git(root, 'push', '--quiet', '-u', 'origin', 'issue-202-malformed-review');
  const head = git(root, 'rev-parse', 'HEAD'); const base = git(root, 'rev-parse', 'main');

  executable(path.join(bin, 'gh'), `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2); appendFileSync(process.env.PASEO_ACCEPTANCE_CALLS, JSON.stringify({cmd:'gh',args})+'\\n');
const out=(v)=>process.stdout.write(JSON.stringify(v));
if(args[0]==='repo'&&args[1]==='view'){out({nameWithOwner:'owner/repo'});process.exit(0)}
if(args[0]==='issue'&&args[1]==='view'){out({number:202,title:'Malformed reviewer acceptance',body:'Acceptance fixture',url:'https://example.invalid/issues/202',comments:[],blockedBy:{nodes:[]},blocking:{nodes:[]}});process.exit(0)}
if(args[0]==='issue'&&(args[1]==='edit'||args[1]==='comment'))process.exit(0);
if(args[0]==='pr'&&args[1]==='list'){out([{number:82,url:'https://example.invalid/pull/82',isDraft:true,headRefOid:process.env.PASEO_ACCEPTANCE_HEAD,baseRefName:'main',baseRefOid:process.env.PASEO_ACCEPTANCE_BASE,mergeable:'MERGEABLE',mergeStateStatus:'CLEAN',statusCheckRollup:[]}]);process.exit(0)}
process.stderr.write('Unhandled fake gh command: '+args.join(' '));process.exit(2);
`);
  executable(path.join(bin, 'paseo'), `#!/usr/bin/env node
const { appendFileSync } = require('node:fs'); const args=process.argv.slice(2);
appendFileSync(process.env.PASEO_ACCEPTANCE_CALLS,JSON.stringify({cmd:'paseo',args})+'\\n');
if(args[0]==='wait')process.exit(0);
if(args[0]==='run'){process.stdout.write('{}');process.exit(0)}
process.stderr.write('Unexpected fake paseo command: '+args.join(' '));process.exit(2);
`);

  saveConfig(root,{version:3,setupComplete:true,baseBranch:'main',pollIntervalSeconds:60,maxActive:1,codingHarness:'fake',issueSelection:{mode:'recommended-labels',excludedLabels:[],temporaryFailureRetries:0},review:{workflow:'full-immediate',quickMaxRounds:2,fullMaxRounds:2,autoMergeApproved:false},models:{orchestrator:'fixture/coder',coder:'fixture/coder',coderThinking:'medium',reviewer:'fixture/reviewer',reviewerThinking:'high'}});
  saveRun(root,202,{issueNumber:202,issueTitle:'Malformed reviewer acceptance',attempt:1,status:LEGACY_LABELS.running,phase:'coding',branch:'issue-202-malformed-review',worktreePath:root,workspaceId:'workspace-202',coderAgentId:'coder-202',agentId:'coder-202',events:[],activity:[],startedAt:new Date(0).toISOString()});

  const controller=fileURLToPath(new URL('../src/controller-worker.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[controller,root,'202'],{cwd:root,encoding:'utf8',env:{...process.env,PATH:`${bin}${path.delimiter}${process.env.PATH||''}`,PASEO_ACCEPTANCE_CALLS:callsFile,PASEO_ACCEPTANCE_HEAD:head,PASEO_ACCEPTANCE_BASE:base,PASEO_COMMAND_TIMEOUT_MS:'10000',PASEO_AGENT_TIMEOUT_MS:'10000'}});

  assert.equal(result.status,1);
  const failed=loadRun(root,202);
  assert.equal(failed.status,LEGACY_LABELS.failed); assert.equal(failed.phase,'failed');
  assert.match(failed.reason||'',/required structured verdict/i);
  assert.equal(failed.prNumber,82); assert.equal(failed.approvedCommit??null,null);
  const validations=(failed.events||[]).filter((event)=>event.event==='validation-summary');
  const reviews=(failed.events||[]).filter((event)=>event.event==='review');
  assert.equal(validations.length,1); assert.equal(validations[0].result,'PASS'); assert.equal(validations[0].commit,head); assert.equal(reviews.length,0);
  const log=calls(callsFile);
  assert.equal(log.filter((call)=>call.cmd==='paseo'&&call.args[0]==='run').length,1);
  assert.equal(log.filter((call)=>call.cmd==='paseo'&&call.args[0]==='send').length,0);
  assert.equal(log.filter((call)=>call.cmd==='gh'&&call.args[0]==='pr'&&call.args[1]==='comment').length,0);
});
