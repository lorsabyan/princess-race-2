import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);

const readArg = (name, fallback) => {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  return args[index + 1] ?? fallback;
};

const hasArg = (name) => args.includes(name);

const promptPath = readArg('--prompt', 'assets/briefs/agy-asset-director.md');
const outputPath = readArg('--out', 'assets/briefs/agy-output.md');
const model = readArg('--model', process.env.AGY_MODEL || 'Gemini 3.5 Flash (High)');
const timeout = readArg('--timeout', process.env.AGY_PRINT_TIMEOUT || '10m');
const stdoutOnly = hasArg('--stdout-only');
const allowUnstructured = hasArg('--allow-unstructured');

const projectRoot = process.cwd();
const promptBody = await readFile(path.resolve(projectRoot, promptPath), 'utf8');
const prompt = [
  'Return only the requested asset production brief. Do not state which model you are. Do not inspect the repository unless it is necessary. Do not ask how to proceed.',
  '',
  promptBody,
].join('\n');

const agyArgs = ['--print', '--model', model, '--print-timeout', timeout, prompt];

if (process.env.AGY_SKIP_PERMISSIONS === '1') {
  agyArgs.unshift('--dangerously-skip-permissions');
}

const child = spawn('agy', agyArgs, {
  cwd: projectRoot,
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';

child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');

child.stdout.on('data', (chunk) => {
  stdout += chunk;
  process.stdout.write(chunk);
});

child.stderr.on('data', (chunk) => {
  stderr += chunk;
  process.stderr.write(chunk);
});

const exitCode = await new Promise((resolve) => {
  child.on('close', resolve);
});

if (exitCode !== 0) {
  throw new Error(`agy exited with code ${exitCode}.${stderr ? `\n${stderr}` : ''}`);
}

if (!stdoutOnly) {
  await mkdir(path.dirname(path.resolve(projectRoot, outputPath)), { recursive: true });
  const stamped = [
    `# agy asset director output`,
    ``,
    `Model: ${model}`,
    `Prompt: ${promptPath}`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    stdout.trim(),
    ``,
  ].join('\n');
  await writeFile(path.resolve(projectRoot, outputPath), stamped, 'utf8');
  console.log(`\nSaved agy output to ${outputPath}`);
}

if (!allowUnstructured && !stdout.includes('# Asset Production Brief')) {
  console.warn(
    '\nWarning: agy did not return the expected "# Asset Production Brief" heading. ' +
      `Raw output was saved to ${outputPath}. Check the active agy model/session before using this as an asset plan.`
  );
}
