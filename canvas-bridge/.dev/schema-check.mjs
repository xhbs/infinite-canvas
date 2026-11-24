// 用 dsh-tools 的真实校验器验证：带 canvasId 的 schema 能否通过注册前的 assertSupportedJsonSchema。
import { readFileSync } from 'node:fs';
import { assertSupportedJsonSchema } from '../../.research/asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/types/json-schema.js';

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8');

// 复用插件里的 cleanToolSchema：从源码里取函数体，用 new Function 执行（避免 import 整个插件触发 apply）
function extract(name) {
  const start = src.indexOf('export function ' + name);
  if (start < 0) throw new Error('找不到 ' + name);
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1).replace('export function', 'function');
    }
  }
  throw new Error('函数体不完整');
}

const helpers = src.slice(src.indexOf('const SCALAR_TYPES'), src.indexOf('export function cleanToolSchema'));
const cleanFn = extract('cleanToolSchema');
const factory = new Function(helpers + '\n' + cleanFn + '\nreturn cleanToolSchema;');
const cleanToolSchema = factory();

const CANVAS_ID = {
  type: 'string',
  description: '目标画布 ID。同时连接多张画布时用它指定；只连一张可省略（默认最近连接的那张）。可先用 canvas_list_canvases 查看。',
};

function withCanvasId(schema) {
  const base = cleanToolSchema(schema);
  if (base && base.type === 'object') {
    return { ...base, properties: { ...(base.properties || {}), canvasId: CANVAS_ID } };
  }
  return { type: 'object', additionalProperties: true, properties: { canvasId: CANVAS_ID } };
}

const samples = [
  { name: 'get_generation_config', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'get_canvas_summary', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  {
    name: 'create_text_node',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 80 },
        content: { type: 'string' },
        sourceNodeIds: { type: 'array', minItems: 1, items: { type: 'string' } },
      },
      required: ['title', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'generate_video',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        seconds: { type: 'integer', minimum: -1, maximum: 30 },
        sourceNodeIds: { type: 'array', items: { type: 'string' } },
        size: { type: 'string', enum: ['1280x720', '720x1280'] },
        warmup: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  { name: '无 schema 的工具', inputSchema: undefined },
  { name: '根不是 object', inputSchema: { type: 'string' } },
];

let pass = 0;
let fail = 0;
for (const sample of samples) {
  const schema = withCanvasId(sample.inputSchema);
  try {
    assertSupportedJsonSchema(schema);
    const hasId = schema.properties && schema.properties.canvasId;
    const required = Array.isArray(schema.required) ? schema.required : [];
    const loose = schema.additionalProperties === true;
    const ok = Boolean(hasId) && !required.includes('canvasId');
    if (ok) {
      pass += 1;
      console.log(`PASS ${sample.name}  键=${Object.keys(schema.properties).join(',')}  additionalProperties=${loose}`);
    } else {
      fail += 1;
      console.log(`FAIL ${sample.name}  canvasId 缺失或被设为必填`);
    }
  } catch (error) {
    fail += 1;
    console.log(`FAIL ${sample.name}  校验拒绝：${error.message}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
