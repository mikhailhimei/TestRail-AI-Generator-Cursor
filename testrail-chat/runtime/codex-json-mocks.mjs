import { randomUUID } from 'node:crypto';

export const MOCK_SCHEMA = { type: 'array', minItems: 1, maxItems: 10, items: {
  type: 'object', additionalProperties: false, required: ['name', 'json'],
  properties: { name: { type: 'string', minLength: 6, maxLength: 100 }, json: { type: 'string', minLength: 1, maxLength: 1048576 } }
} };
export function mergeJsonMocks(existing = [], inputs = []) {
  const result = existing.map(item => ({ ...item }));
  const names = new Set();
  for (const input of inputs) {
    if (!input || typeof input.name !== 'string' || input.name !== input.name.trim() || !/\.json$/i.test(input.name) || input.name.length > 100 || /[\\/"\r\n\x00-\x1f]/.test(input.name)) throw Error('Моку нужно безопасное имя файла с расширением .json');
    if (typeof input.json !== 'string' || !input.json.trim()) throw Error('Содержимое мока должно быть строкой JSON');
    JSON.parse(input.json);
    const name = input.name.toLowerCase();
    if (names.has(name)) throw Error('Имена моков в запросе повторяются');
    names.add(name);
    const index = result.findIndex(item => item.name.toLowerCase() === name);
    const item = { ...(index >= 0 ? result[index] : { id: randomUUID() }), name: input.name, json: input.json, uploadError: undefined };
    if (index >= 0) result[index] = item; else result.push(item);
  }
  if (result.length > 10 || result.reduce((sum, item) => sum + Buffer.byteLength(item.json, 'utf8'), 0) > 1048576) throw Error('Допускается до 10 JSON-моков суммарно до 1 МБ');
  return result;
}
