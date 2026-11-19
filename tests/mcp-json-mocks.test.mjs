import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
const root = process.env.MCP_RUNTIME || fileURLToPath(new URL('../testrail-chat/runtime/', import.meta.url));
const { createChatChannel, CHAT_TOOLS } = await import(pathToFileURL(root + '/codex-chat.mjs'));
const { mergeJsonMocks } = await import(pathToFileURL(root + '/codex-json-mocks.mjs'));
const state = { sessionId: 'panel', revision: 'r1', busy: false, rawText: '', instructions: '', cases: [
  { id: 'case-1', title: 'Keep case', type: 'Functional', priority: 'Critical', preconditions: 'Original requirements', steps: [], jsonMocks: [{ id: 'existing-file', name: 'old.json', json: '{}' }] }
], prompts: [{ id: 'A', name: 'Default', content: 'rules' }] };
const rpc = (channel, method, params) => channel.rpc({ jsonrpc: '2.0', id: 1, method, params });
const extract = response => JSON.parse(response.result.content[0].text);
test('MCP advertises named JSON files and existing-case upsert to every client', async () => {
 const channel=createChatChannel({commandTimeoutMs:100});
 try {
  const init=await rpc(channel,'initialize');assert.match(init.result.instructions,/upsert_case_mocks/);assert.match(init.result.instructions,/not just text in preconditions/);
  assert.ok(CHAT_TOOLS.find(t=>t.name==='upsert_case_mocks'));
  assert.ok(CHAT_TOOLS.find(t=>t.name==='add_test_cases').inputSchema.properties.cases.items.properties.jsonMocks);
  channel.poll(state);
  const invalid=await rpc(channel,'tools/call',{name:'upsert_case_mocks',arguments:{sessionId:'panel',expectedRevision:'r1',caseId:'case-1',mocks:[{name:'bad.json',json:'{bad}'}]}});
  assert.equal(invalid.result.isError,true);
  const pending=rpc(channel,'tools/call',{name:'upsert_case_mocks',arguments:{sessionId:'panel',expectedRevision:'r1',caseId:'case-1',mocks:[{name:'list.json',json:'{"items":[]}'}]}});
  const commands=channel.poll(state).commands;assert.equal(commands.length,1);assert.equal(commands[0].name,'upsert_case_mocks');
  channel.complete({id:commands[0].id,sessionId:'panel',ok:true,state});assert.equal(extract(await pending).applied,true);
 } finally {channel.close();}
});
test('mock merge preserves files and IDs; malformed payloads never become attachments',()=>{
 const previous=state.cases[0].jsonMocks;
 const next=mergeJsonMocks(previous,[{name:'list.json',json:'{"items":[]}'}]);assert.equal(next.length,2);assert.equal(next[0].id,'existing-file');
 const edited=mergeJsonMocks(next,[{name:'list.json',json:'{"items":[1]}'}]);assert.equal(edited.length,2);assert.equal(edited[1].id,next[1].id);
 assert.throws(()=>mergeJsonMocks([], [{name:'../bad.json',json:'{}'}]));assert.throws(()=>mergeJsonMocks([], [{name:'bad.json',json:'bad'}]));
});
