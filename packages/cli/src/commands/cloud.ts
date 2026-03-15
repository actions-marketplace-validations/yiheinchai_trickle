/**
 * trickle cloud — upload/download observability data to a shared cloud endpoint.
 *
 * Commands:
 *   trickle cloud push              Upload .trickle/ data to the cloud
 *   trickle cloud pull              Download latest data from the cloud
 *   trickle cloud share             Generate a shareable link to the dashboard
 *   trickle cloud status            Check cloud sync status
 *
 * Requires TRICKLE_CLOUD_URL and TRICKLE_CLOUD_TOKEN env vars.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

const CLOUD_URL = process.env.TRICKLE_CLOUD_URL || 'https://cloud.trickle.dev';
const CLOUD_TOKEN = process.env.TRICKLE_CLOUD_TOKEN || '';

function findTrickleDir(): string {
  return process.env.TRICKLE_LOCAL_DIR || path.join(process.cwd(), '.trickle');
}

function readDataFiles(trickleDir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const dataFiles = [
    'observations.jsonl', 'variables.jsonl', 'calltrace.jsonl',
    'queries.jsonl', 'errors.jsonl', 'console.jsonl', 'profile.jsonl',
    'traces.jsonl', 'websocket.jsonl', 'alerts.jsonl', 'heal.jsonl',
    'environment.json', 'baseline.json',
  ];
  for (const f of dataFiles) {
    const fp = path.join(trickleDir, f);
    if (fs.existsSync(fp)) {
      files[f] = fs.readFileSync(fp, 'utf-8');
    }
  }
  return files;
}

export async function cloudPush(): Promise<void> {
  const trickleDir = findTrickleDir();
  if (!fs.existsSync(trickleDir)) {
    console.log(chalk.yellow('  No .trickle/ directory found. Run your app with trickle first.'));
    return;
  }

  if (!CLOUD_TOKEN) {
    console.log(chalk.yellow('  Set TRICKLE_CLOUD_TOKEN to authenticate with the cloud.'));
    console.log(chalk.gray('  Get a token at https://cloud.trickle.dev/settings'));
    return;
  }

  const files = readDataFiles(trickleDir);
  const fileCount = Object.keys(files).length;

  console.log('');
  console.log(chalk.bold('  trickle cloud push'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log(`  Uploading ${fileCount} data files...`);

  try {
    const res = await fetch(`${CLOUD_URL}/api/v1/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CLOUD_TOKEN}`,
      },
      body: JSON.stringify({
        project: path.basename(process.cwd()),
        files,
        timestamp: Date.now(),
      }),
    });

    if (res.ok) {
      const data = await res.json() as any;
      console.log(chalk.green(`  ✓ Uploaded ${fileCount} files`));
      if (data.url) console.log(`  Dashboard: ${chalk.cyan(data.url)}`);
      if (data.shareId) console.log(`  Share ID: ${chalk.bold(data.shareId)}`);
    } else {
      console.log(chalk.red(`  ✗ Upload failed: ${res.status} ${res.statusText}`));
    }
  } catch (err: any) {
    if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
      console.log(chalk.yellow(`  Cloud service not available at ${CLOUD_URL}`));
      console.log(chalk.gray('  The cloud dashboard is coming soon. For now, use trickle dashboard-local.'));
    } else {
      console.log(chalk.red(`  ✗ Error: ${err.message}`));
    }
  }

  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log('');
}

export async function cloudPull(): Promise<void> {
  if (!CLOUD_TOKEN) {
    console.log(chalk.yellow('  Set TRICKLE_CLOUD_TOKEN to authenticate.'));
    return;
  }

  console.log('');
  console.log(chalk.bold('  trickle cloud pull'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));

  try {
    const res = await fetch(`${CLOUD_URL}/api/v1/pull?project=${encodeURIComponent(path.basename(process.cwd()))}`, {
      headers: { 'Authorization': `Bearer ${CLOUD_TOKEN}` },
    });

    if (res.ok) {
      const data = await res.json() as any;
      const trickleDir = findTrickleDir();
      fs.mkdirSync(trickleDir, { recursive: true });
      let count = 0;
      for (const [filename, content] of Object.entries(data.files || {})) {
        fs.writeFileSync(path.join(trickleDir, filename), content as string, 'utf-8');
        count++;
      }
      console.log(chalk.green(`  ✓ Downloaded ${count} files`));
    } else {
      console.log(chalk.red(`  ✗ Download failed: ${res.status}`));
    }
  } catch (err: any) {
    console.log(chalk.yellow(`  Cloud service not available. Use trickle dashboard-local instead.`));
  }

  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log('');
}

export async function cloudShare(): Promise<void> {
  const trickleDir = findTrickleDir();
  if (!fs.existsSync(trickleDir)) {
    console.log(chalk.yellow('  No .trickle/ directory found.'));
    return;
  }

  console.log('');
  console.log(chalk.bold('  trickle cloud share'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));

  // Generate a local share: pack all data into a single JSON file
  const files = readDataFiles(trickleDir);
  const bundle = {
    version: 1,
    project: path.basename(process.cwd()),
    timestamp: Date.now(),
    files,
  };

  const sharePath = path.join(trickleDir, 'share-bundle.json');
  fs.writeFileSync(sharePath, JSON.stringify(bundle), 'utf-8');
  const sizeMb = (fs.statSync(sharePath).size / 1024 / 1024).toFixed(1);

  console.log(`  Bundle: ${chalk.bold(path.relative(process.cwd(), sharePath))} (${sizeMb}MB)`);
  console.log(chalk.gray('  Share this file with your team, or upload to cloud:'));
  console.log(chalk.gray('    trickle cloud push'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log('');
}

export async function cloudStatus(): Promise<void> {
  const trickleDir = findTrickleDir();
  console.log('');
  console.log(chalk.bold('  trickle cloud status'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log(`  Cloud URL: ${chalk.gray(CLOUD_URL)}`);
  console.log(`  Token: ${CLOUD_TOKEN ? chalk.green('configured') : chalk.yellow('not set')}`);
  console.log(`  Local data: ${fs.existsSync(trickleDir) ? chalk.green('available') : chalk.yellow('none')}`);

  if (fs.existsSync(trickleDir)) {
    const files = readDataFiles(trickleDir);
    console.log(`  Files: ${Object.keys(files).length}`);
  }

  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log('');
}
