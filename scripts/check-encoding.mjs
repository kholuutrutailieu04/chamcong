import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_DIRS = ['src', 'scripts'];
const FILE_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.sql',
  '.css',
  '.html',
  '.yml',
  '.yaml',
]);
const IGNORED_DIRS = new Set(['node_modules', '.next', '.git', '.venv', '__pycache__', 'local-docs', 'docs', 'supabase']);

const suspiciousPatterns = [
  /\uFFFD/g,
  /\u00C3[\u0080-\u00BF\u0192]/g,
  /\u00C2[\u0080-\u00BF]/g,
  /\u00C3\u201E(?=[A-Za-z])/g,
  /\u00C3\u2020(?=[A-Za-z])/g,
  /\u00C3\u00A2\u00E2\u20AC[\u0080-\uFFFF]?/g,
  /\u00C3\u00A2\u00C5[\u0090-\uFFFF]?/g,
  /\u00C3\u00A1\u00C2\u00BA/g,
];

function walk(dir, files) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walk(fullPath, files);
      continue;
    }
    if (FILE_EXTS.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }
}

const files = [];
for (const dir of TARGET_DIRS) walk(path.join(ROOT, dir), files);

const issues = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const hits = suspiciousPatterns.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
  if (hits.length > 0) {
    issues.push(`${path.relative(ROOT, file)} (${hits.join(', ')})`);
  }
}

if (issues.length > 0) {
  console.error('Encoding check failed. Potential mojibake detected:');
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log('Encoding check passed.');
